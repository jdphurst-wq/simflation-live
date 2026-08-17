import fs from 'node:fs';
import vm from 'node:vm';

const sourcePath='SimFlation-0.11.1.html';
const outputPath='SimFlation-0.11.2.html';
let html=fs.readFileSync(sourcePath,'utf8');

function scanBalanced(start,openChar,closeChar){
  let depth=0,quote=null,escaped=false,lineComment=false,blockComment=false;
  for(let i=start;i<html.length;i++){
    const c=html[i],n=html[i+1];
    if(lineComment){if(c==='\n')lineComment=false;continue}
    if(blockComment){if(c==='*'&&n==='/'){blockComment=false;i++}continue}
    if(quote){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c===quote)quote=null;continue}
    if(c==='/'&&n==='/'){lineComment=true;i++;continue}
    if(c==='/'&&n==='*'){blockComment=true;i++;continue}
    if(c==='\''||c==='"'||c==='`'){quote=c;continue}
    if(c===openChar)depth++;
    else if(c===closeChar&&--depth===0)return i;
  }
  throw new Error(`Unclosed ${openChar}${closeChar} block at ${start}`)
}
function functionRange(name){
  const needle=`function ${name}(`,start=html.indexOf(needle);
  if(start<0)throw new Error(`Missing function ${name}`);
  if(html.indexOf(needle,start+needle.length)>=0)throw new Error(`Non-unique function ${name}`);
  const paren=html.indexOf('(',start),parenEnd=scanBalanced(paren,'(',')'),body=html.indexOf('{',parenEnd),end=scanBalanced(body,'{','}');
  return{start,end:end+1}
}
function functionRangeFrom(start){const paren=html.indexOf('(',start),parenEnd=scanBalanced(paren,'(',')'),body=html.indexOf('{',parenEnd),end=scanBalanced(body,'{','}');return{start,end:end+1}}
function replaceFunction(name,replacement){const {start,end}=functionRange(name);html=html.slice(0,start)+replacement+html.slice(end)}
function insertAfterFunction(name,addition){const {end}=functionRange(name);html=html.slice(0,end)+addition+html.slice(end)}
function replaceOnce(label,before,after){const i=html.indexOf(before);if(i<0)throw new Error(`Missing patch target: ${label}`);if(html.indexOf(before,i+before.length)>=0)throw new Error(`Non-unique patch target: ${label}`);html=html.slice(0,i)+after+html.slice(i+before.length)}
function replaceBetween(label,startMarker,endMarker,replacement){const a=html.indexOf(startMarker),b=html.indexOf(endMarker,a+startMarker.length);if(a<0||b<0)throw new Error(`Missing range: ${label}`);html=html.slice(0,a)+replacement+html.slice(b)}

replaceFunction('createBank',`function createBank(name,entrant=false){return{
    id:nextBankId++,name:name||'Bank '+nextBankId,active:true,reserves:0,bonds:0,centralBankBorrowing:0,liquidityArrears:0,
    resolutionProvision:0,publicResolutionEquity:0,age:0,quietMonths:0,monthInterest:0,monthCosts:0,monthDefaults:0,monthOriginations:0,
    resolutionCooldown:0,lastBailoutIndex:null,supportPlanMonths:0,emergencyBackstopUsed:false,liquidityDistressMonths:0,underCapitalMonths:0,
    insolvencyMonths:0,lossMonths:0,entryRampMonths:entrant?24:0,failedEntry:false,mutualResolution:false,
    shareholders:entrant&&households.length?generateShareholderSlots(16):[]
  }}`);

replaceFunction('bankResolutionLossBuffer',`function bankResolutionLossBuffer(bank){
    if(!bank?.active)return 0;
    const firmExpected=sum(firms.filter(f=>f.lenderBankId===bank.id&&(f.debt||0)>0).map(f=>{
      const debt=Math.max(0,f.debt||0),missed=f.missedPayments||0,npl=f.nonPerformingMonths||0,admin=f.administrationMonths||0,insolvency=f.insolvencyMonths||0;
      const probability=admin>0?.72:insolvency>=3?.48:npl>=6?.36:npl>=3?.22:missed>=1?.08:.008;
      const recovery=clamp((f.capitalValue||0)*.35+(f.stock||0)*(f.price||0)*.15,0,debt),lossGivenDefault=1-recovery/Math.max(1,debt);
      return debt*probability*clamp(lossGivenDefault,.20,.90)
    }));
    const propertyExpected=sum([...landlords,developer].filter(Boolean).filter(x=>x.lenderBankId===bank.id&&(x.debt||0)>0).map(x=>{
      const debt=Math.max(0,x.debt||0),missed=x.missedPayments||0,npl=x.nonPerformingMonths||0,collateral=Math.max(0,propertyAssetValue(x)*.68),probability=npl>=6?.40:npl>=3?.20:missed>=1?.07:.006;
      return debt*probability*clamp(1-collateral/Math.max(1,debt),.15,.80)
    }));
    const mortgageExpected=sum(housingUnits.filter(u=>u.mortgageBankId===bank.id&&(u.mortgageBalance||0)>0).map(u=>{
      const debt=Math.max(0,u.mortgageBalance||0),arrears=u.arrears||0,collateral=Math.max(0,(u.price||0)*.72),probability=arrears>=9?.38:arrears>=6?.22:arrears>=3?.09:.004;
      return debt*probability*clamp(1-collateral/Math.max(1,debt),.10,.65)
    }));
    return Math.min(Math.max(0,bankRWA(bank))*.12,firmExpected+propertyExpected+mortgageExpected)
  }`);

insertAfterFunction('privateCreditRoom',`
  function bankNplExposure(bank){
    if(!bank)return 0;
    const firmsNpl=sum(firms.filter(f=>f.lenderBankId===bank.id&&((f.nonPerformingMonths||0)>=3||(f.administrationMonths||0)>0)).map(f=>Math.max(0,f.debt||0)));
    const propertyNpl=sum([...landlords,developer].filter(Boolean).filter(x=>x.lenderBankId===bank.id&&(x.nonPerformingMonths||0)>=3).map(x=>Math.max(0,x.debt||0)));
    const mortgageNpl=sum(housingUnits.filter(u=>u.mortgageBankId===bank.id&&(u.arrears||0)>=3).map(u=>Math.max(0,u.mortgageBalance||0)));
    return firmsNpl+propertyNpl+mortgageNpl
  }
  function bankNplRatio(bank){return bankNplExposure(bank)/Math.max(1,bankFirmLoans(bank.id)+bankMortgages(bank.id))}
  function eligibleCentralBankCollateral(bank){
    if(!bank?.active||bankEquity(bank)<=0)return 0;
    const performing=Math.max(0,bankFirmLoans(bank.id)+bankMortgages(bank.id)-bankNplExposure(bank));
    return Math.max(0,bank.bonds||0)*.82+performing*.18
  }
  function centralBankLiquidityLimit(bank){
    if(!bank?.active||bankEquity(bank)<=0)return 0;
    const deposits=Math.max(0,bankDeposits(bank.id)),equity=Math.max(0,bankEquity(bank)),collateral=eligibleCentralBankCollateral(bank);
    return Math.max(0,Math.min(collateral,deposits*.12,equity*.85))
  }
  function centralBankLiquidityRoom(bank){return Math.max(0,centralBankLiquidityLimit(bank)-Math.max(0,bank?.centralBankBorrowing||0))}
  function drawCentralBankLiquidity(bank,requested){
    const draw=Math.min(Math.max(0,requested),centralBankLiquidityRoom(bank));
    if(draw>0){bank.centralBankBorrowing=(bank.centralBankBorrowing||0)+draw;bank.reserves=(bank.reserves||0)+draw}
    return draw
  }
  function bankSettlementCapacity(bank){return bank?.active?Math.max(0,bank.reserves||0)+centralBankLiquidityRoom(bank):0}
  function settleBankPayment(from,to,requested){
    if(!from||!from.active||requested<=0)return 0;
    const wanted=Math.max(0,requested);if(!to||from.id===to.id)return wanted;
    const need=Math.max(0,wanted-Math.max(0,from.reserves||0));if(need>0)drawCentralBankLiquidity(from,need);
    const paid=Math.min(wanted,Math.max(0,from.reserves||0));
    if(paid>0){from.reserves-=paid;to.reserves=(to.reserves||0)+paid}
    return paid
  }
  function bankLiquidityStress(bank){
    if(!bank?.active)return 1;
    const deposits=Math.max(1,bankDeposits(bank.id)),reserveRatio=Math.max(0,bank.reserves||0)/deposits,limit=centralBankLiquidityLimit(bank),usage=limit>0?Math.max(0,bank.centralBankBorrowing||0)/limit:0,arrears=Math.max(0,bank.liquidityArrears||0)/deposits;
    return clamp(Math.max((.055-reserveRatio)/.055,(usage-.65)/.35,arrears/.01),0,1)
  }
  function bankSevereLiquidityDistress(bank){return !bank?.active||bankLiquidityStress(bank)>.94||bankSettlementCapacity(bank)<Math.max(2500*nominalScale(),bankDeposits(bank.id)*.005)}
  function bankOriginationBudget(bank){
    if(!bank?.active)return 0;
    const book=Math.max(0,bankFirmLoans(bank.id)+bankMortgages(bank.id)),equity=Math.max(0,bankEquity(bank)),deposits=Math.max(0,bankDeposits(bank.id)),ramp=bank.entryRampMonths>0?clamp((25-bank.entryRampMonths)/24,.08,1):1;
    const monthlyGrowth=Math.max(25000*nominalScale(),book*.06+equity*.18),fundingRoom=Math.max(22000*nominalScale(),deposits*.10+Math.max(0,bank.reserves||0)*.25);
    return Math.max(0,Math.min(monthlyGrowth,fundingRoom)*ramp)
  }
  function bankOperatingCost(bank){
    const assets=Math.max(0,bankAssets(bank)),scale=Math.max(1,nominalScale()),base=(120+Math.sqrt(assets/scale)*2.1)*scale,earningsCap=Math.max(650*scale,Math.max(0,bank.monthInterest||0)*.42+Math.max(0,bankEquity(bank))*.00018),economyCap=annualGDPReference()/12*.0015;
    return Math.max(0,Math.min(base,earningsCap,economyCap))
  }
  function registerInterestArrears(borrower,shortfall){
    const missed=Math.max(0,shortfall);if(missed<=0)return 0;
    borrower.interestArrears=(borrower.interestArrears||0)+missed;borrower.missedPayments=(borrower.missedPayments||0)+1;
    borrower.nonPerformingMonths=borrower.missedPayments>=3?(borrower.nonPerformingMonths||0)+1:Math.max(0,borrower.nonPerformingMonths||0);
    return missed
  }
  function v0112RaisePrivateBankCapital(bank,requested,requireFull=false){
    const target=Math.max(0,requested);if(!bank?.active||target<=0)return 0;
    let raised=0;const contributions=[];
    for(const h of [...households].sort((a,b)=>investorWeight(b)-investorWeight(a))){
      if(raised>=target)break;let amount=Math.min(Math.max(0,h.cash-Math.max(2500*nominalScale(),h.income*6)),target-raised,target*.07);if(amount<=0)continue;
      const source=bankById(h.bankId);if(source&&source.id!==bank.id)amount=settleBankPayment(source,bank,amount);if(amount<=0)continue;
      h.cash-=amount;contributions.push({h,sourceId:h.bankId,amount});raised+=amount;if(bankBalanceCache)v011AdjustDepositCache(h.bankId,-amount);if(!bank.shareholders.includes(h.id))bank.shareholders.push(h.id)
    }
    let foreignRaised=0;if(raised<target){foreignRaised=foreignBankRecap(bank,Math.min(target-raised,annualGDPReference()*.004));raised+=foreignRaised}
    if(requireFull&&raised<target*.88){
      for(const item of contributions){item.h.cash+=item.amount;const source=bankById(item.sourceId);if(source&&source.id!==bank.id)settleBankPayment(bank,source,item.amount);if(bankBalanceCache)v011AdjustDepositCache(item.sourceId,item.amount)}
      bank.reserves=Math.max(0,bank.reserves-foreignRaised);world.netInternationalInvestmentPosition+=foreignRaised;invalidateBankBalanceCache();return 0
    }
    invalidateBankBalanceCache();return raised
  }
  function v0112ResolutionCapital(bank,requested,route){
    if(!bank?.active||requested<=0||$('bankPolicy').value==='noSupport')return 0;
    const cap=Math.min(annualGDPReference()*.006,Math.max(60000*nominalScale(),bankRWA(bank)*.10)),amount=Math.min(Math.max(0,requested),cap),paid=governmentPaysBank(bank,amount,'bankSupportSpending');
    if(paid>0)bank.publicResolutionEquity=(bank.publicResolutionEquity||0)+paid;
    return paid
  }
  function v0112RestoreFacilityCompliance(bank){
    if(!bank?.active)return{compliant:false,privateCapital:0,governmentSupport:0,liquidityRepayment:0};let limit=centralBankLiquidityLimit(bank),excess=Math.max(0,(bank.centralBankBorrowing||0)-limit);if(excess<=.01)return{compliant:true,privateCapital:0,governmentSupport:0,liquidityRepayment:0};
    const target=excess*1.20+Math.max(2500*nominalScale(),(bank.centralBankBorrowing||0)*.002),privateCapital=v0112RaisePrivateBankCapital(bank,target,false);limit=centralBankLiquidityLimit(bank);excess=Math.max(0,(bank.centralBankBorrowing||0)-limit);
    let governmentSupport=0;if(excess>.01&&$('bankPolicy').value!=='noSupport')governmentSupport=v0112ResolutionCapital(bank,excess*1.20+Math.max(2500*nominalScale(),excess*.05),'collateralised liquidity restoration');
    limit=centralBankLiquidityLimit(bank);excess=Math.max(0,(bank.centralBankBorrowing||0)-limit);if(excess>.01&&$('bankPolicy').value==='noSupport'&&Math.abs(limit-Math.max(0,bankEquity(bank))*.85)<=Math.max(.01,limit*1e-8))applyUninsuredDepositBailIn(bankCustomers(bank.id),excess/.85*1.03);
    limit=centralBankLiquidityLimit(bank);excess=Math.max(0,(bank.centralBankBorrowing||0)-limit);let liquidityRepayment=0;if(excess>0&&bank.reserves>0){liquidityRepayment=Math.min(excess,bank.centralBankBorrowing,bank.reserves);bank.centralBankBorrowing-=liquidityRepayment;bank.reserves-=liquidityRepayment}
    invalidateBankBalanceCache();return{compliant:(bank.centralBankBorrowing||0)<=centralBankLiquidityLimit(bank)+Math.max(.01,centralBankLiquidityLimit(bank)*1e-9),privateCapital,governmentSupport,liquidityRepayment}
  }
`);

// Remove the 0.11.1 helper declarations now superseded by the 0.11.2 settlement layer.
for(const name of ['centralBankLiquidityLimit','centralBankLiquidityRoom','drawCentralBankLiquidity','bankSettlementCapacity','settleBankPayment','bankLiquidityStress','bankSevereLiquidityDistress','bankOriginationBudget','bankOperatingCost','registerInterestArrears']){
  const first=html.indexOf(`function ${name}(`),second=html.indexOf(`function ${name}(`,first+1);
  if(first>=0&&second>=0){const {start,end}=functionRangeFrom(second);html=html.slice(0,start)+html.slice(end)}
}

replaceFunction('loanRate',`function loanRate(bank){
    if(!bank)return clamp(Number($('interestRate').value)+6,0,30);
    const requirement=Math.max(.04,Number($('capitalRequirement').value)/100),capitalPenalty=Math.max(0,requirement+.025-bankCapitalRatio(bank))*45,liquidityPenalty=bankLiquidityStress(bank)*7,nplPenalty=clamp(bankNplRatio(bank)*18,0,7);
    return clamp(Number($('interestRate').value)+2.25+capitalPenalty+liquidityPenalty+nplPenalty,0,30)
  }`);
replaceFunction('bankCreditCapacity',`function bankCreditCapacity(bank,riskWeight=1,recipientBankId=null){
    if(!bank?.active||bankEquity(bank)<=0||bankSevereLiquidityDistress(bank)||bank.name.startsWith('Bridge Bank')&&bank.resolutionCooldown>0)return 0;
    const requirement=Math.max(.04,Number($('capitalRequirement').value)/100),equity=bankEquity(bank),rwa=bankRWA(bank),capitalRoom=Math.max(0,(equity/requirement-rwa)/Math.max(.05,riskWeight)),leverageRoom=Math.max(0,equity*12.5-bankAssets(bank)),growthRoom=Math.max(0,bankOriginationBudget(bank)-Math.max(0,bank.monthOriginations||0));
    let capacity=Math.min(capitalRoom,leverageRoom,growthRoom,privateCreditRoom());if(recipientBankId!==null&&recipientBankId!==bank.id)capacity=Math.min(capacity,bankSettlementCapacity(bank));return Math.max(0,capacity)
  }`);
replaceFunction('chooseBank',`function chooseBank(kind='loan'){
    const requirement=Math.max(.04,Number($('capitalRequirement').value)/100),all=activeBanks().filter(b=>bankEquity(b)>0&&!b.failedEntry),viable=all.filter(b=>bankCapitalRatio(b)>=requirement&&b.resolutionCooldown===0&&!bankSevereLiquidityDistress(b));
    const options=kind==='deposit'?(viable.length?viable:all.filter(b=>bankLiquidityStress(b)<.95)) : viable.filter(b=>bankCreditCapacity(b,1,b.id)>0);
    return weighted(options,b=>{const capital=clamp(bankCapitalRatio(b),.01,.40),liquidity=clamp(bankLiquidity(b)+.10,.01,.50),quality=clamp(1-bankNplRatio(b),.10,1);return kind==='deposit'?capital+liquidity+quality*.12:capital*liquidity*quality/Math.max(1,loanRate(b))})||null
  }`);
replaceFunction('switchBank',`function switchBank(entity,newId){
    if(entity.bankId===newId)return true;const oldId=entity.bankId,old=bankById(oldId),next=bankById(newId),cash=Math.max(0,entity.cash||0);if(!next?.active)return false;
    if(old&&old.id!==next.id&&cash>0){const settled=settleBankPayment(old,next,cash);if(settled+1e-6<cash){if(settled>0)settleBankPayment(next,old,settled);return false}}
    if(bankBalanceCache){v011AdjustDepositCache(oldId,-cash);v011AdjustDepositCache(newId,cash)}entity.bankId=newId;return true
  }`);
replaceFunction('domesticTransfer',`function domesticTransfer(payer,payee,requested){
    let amount=Math.min(Math.max(0,requested),Math.max(0,payer?.cash||0));if(amount<=0||!payee)return 0;
    const from=bankById(payer.bankId),to=bankById(payee.bankId);if(from&&to&&from.id!==to.id)amount=settleBankPayment(from,to,amount);if(amount<=0)return 0;
    payer.cash-=amount;payee.cash=(payee.cash||0)+amount;if(bankBalanceCache){v011AdjustDepositCache(payer.bankId,-amount);v011AdjustDepositCache(payee.bankId,amount)}return amount
  }`);
replaceFunction('externalOut',`function externalOut(payer,requested,reason='external payment',roomOverride=0){
    let amount=Math.min(Math.max(0,requested),Math.max(0,payer?.cash||0),Math.max(externalPaymentRoom(),Math.max(0,roomOverride)));if(amount<=0)return 0;const bank=bankById(payer.bankId);if(bank){const need=Math.max(0,amount-Math.max(0,bank.reserves));if(need>0)drawCentralBankLiquidity(bank,need);amount=Math.min(amount,Math.max(0,bank.reserves));if(amount<=0)return 0;bank.reserves-=amount}payer.cash-=amount;if(bankBalanceCache)v011AdjustDepositCache(payer.bankId,-amount);world.netInternationalInvestmentPosition-=amount;recordExternalFlow('out',amount,reason,isHouseholdAgent(payer)?'household':isFirmAgent(payer)?'firm':'other');return amount
  }`);
replaceFunction('payToBank',`function payToBank(payer,bankId,requested){
    let amount=Math.min(Math.max(0,requested),Math.max(0,payer?.cash||0));if(amount<=0)return 0;const source=bankById(payer.bankId),recipient=bankById(bankId);if(!recipient?.active)return 0;
    if(source&&source.id!==recipient.id)amount=settleBankPayment(source,recipient,amount);if(amount<=0)return 0;
    payer.cash-=amount;if(bankBalanceCache)v011AdjustDepositCache(payer.bankId,-amount);return amount
  }`);
replaceFunction('bankPaysEntity',`function bankPaysEntity(bankId,payee,requested){
    const bank=bankById(bankId),recipient=bankById(payee?.bankId);if(!bank?.active||!payee||requested<=0)return 0;let paid=Math.max(0,requested);
    if(recipient&&recipient.id!==bank.id)paid=settleBankPayment(bank,recipient,paid);if(paid<=0)return 0;
    payee.cash=(payee.cash||0)+paid;if(bankBalanceCache)v011AdjustDepositCache(payee.bankId,paid);return paid
  }`);
replaceFunction('bankPaysBank',`function bankPaysBank(fromId,toId,requested){const from=bankById(fromId),to=bankById(toId);if(!from?.active||!to?.active||requested<=0)return 0;return from.id===to.id?Math.max(0,requested):settleBankPayment(from,to,requested)}`);
replaceFunction('repayCredit',`function repayCredit(borrower,requested){if(!borrower?.debt||borrower.lenderBankId===null)return 0;const amount=payToBank(borrower,borrower.lenderBankId,Math.min(requested,borrower.debt));borrower.debt=Math.max(0,borrower.debt-amount);if(amount>0){borrower.interestArrears=Math.max(0,(borrower.interestArrears||0)-amount*.05);borrower.missedPayments=Math.max(0,(borrower.missedPayments||0)-1)}invalidateBankBalanceCache();return amount}`);
replaceFunction('createCredit',`function createCredit(borrower,requested,type='business'){
    let bank=borrower.lenderBankId!==null?bankById(borrower.lenderBankId):null;const recipient=bankById(borrower.bankId),riskWeight=type==='mortgage'?.50:1;
    if(!bank?.active||bank.resolutionCooldown>0||bankCreditCapacity(bank,riskWeight,recipient?.id)<=0)bank=chooseBank('loan');if(!bank)return 0;
    const gdp=Math.max(1,annualGDPReference()),revenue=Math.max(12000*nominalScale(),borrower.expectedRevenue||0),assetBase=type==='developer'?Math.max(0,propertyAssetValue(borrower)) : Math.max(0,borrower.capitalValue||0),borrowerLimit=type==='developer'?Math.min(gdp*.16,assetBase*.75+gdp*.015):Math.min(gdp*.10,revenue*15+assetBase*.60),concentrationLimit=Math.max(35000*nominalScale(),bankEquity(bank)*(type==='developer'?.25:.20)),room=Math.max(0,Math.min(borrowerLimit,concentrationLimit)-(borrower.debt||0));
    let amount=Math.min(Math.max(0,requested),room,bankCreditCapacity(bank,riskWeight,recipient?.id),privateCreditRoom());if(amount<=0)return 0;if(recipient&&bank.id!==recipient.id)amount=settleBankPayment(bank,recipient,amount);if(amount<=0)return 0;
    borrower.cash=(borrower.cash||0)+amount;borrower.debt=(borrower.debt||0)+amount;borrower.lenderBankId=bank.id;bank.monthOriginations=(bank.monthOriginations||0)+amount;invalidateBankBalanceCache();return amount
  }`);
replaceFunction('capitaliseNewBank',`function capitaliseNewBank(bank,target=Math.max(220000*nominalScale(),annualGDPReference()*.0045)){
    const raised=v0112RaisePrivateBankCapital(bank,target,true),viable=raised>=target*.88&&raised>=Math.max(180000*nominalScale(),annualGDPReference()*.0035);
    if(!viable){bank.active=false;bank.failedEntry=true;bank.reserves=0;bank.centralBankBorrowing=0;invalidateBankBalanceCache();return 0}
    bank.failedEntry=false;bank.entryRampMonths=24;invalidateBankBalanceCache();return raised
  }`);
replaceFunction('governmentPaysBank',`function governmentPaysBank(bank,requested,category){
    if(!bank?.active||requested<=0)return 0;ensureGovernmentCash(requested);let amount=Math.min(Math.max(0,requested),Math.max(0,government.cash));const source=bankById(government.bankId);if(source&&source.id!==bank.id)amount=settleBankPayment(source,bank,amount);if(amount<=0)return 0;
    government.cash-=amount;government[category]=(government[category]||0)+amount;if(category==='bankSupportSpending'){government.cumulativeBankSupport=(government.cumulativeBankSupport||0)+amount;government.bankInvestments[bank.id]=(government.bankInvestments[bank.id]||0)+amount}return amount
  }`);
replaceFunction('issueDebt',`function issueDebt(requested){
    let left=Math.max(0,requested),issued=0;const govtBank=bankById(government.bankId),annualGDP=annualGDPReference(),standstill=recentSovereignRestructurings()>=3&&government.debt>annualGDP*.90,ceiling=annualGDP*(standstill?.95:1.60+(government.marketAccess||1)*.90),room=Math.max(0,ceiling-government.debt),marketAccess=standstill?0:(government.marketAccess??1);left=Math.min(left,room);if(left<=0)return 0;
    for(const bank of activeBanks().filter(b=>b.id!==resolvingBankId).sort((a,b)=>bankSettlementCapacity(b)-bankSettlementCapacity(a))){if(left<=.001)break;const buffer=Math.max(15000*nominalScale(),bankDeposits(bank.id)*.08),capacity=Math.max(0,bank.reserves-buffer)*marketAccess,wanted=Math.min(left,capacity);if(wanted<=0)continue;const amount=bank.id===govtBank?.id?wanted:settleBankPayment(bank,govtBank,wanted);if(amount<=0)continue;bank.bonds+=amount;government.cash+=amount;left-=amount;issued+=amount}
    const centralLimit=annualGDP*(standstill?.00025:government.sovereignCrisisMonths>0?.006:.002)/12,centralAmount=Math.min(left,centralLimit);if(centralAmount>0){government.cash+=centralAmount;if(govtBank)govtBank.reserves+=centralAmount;world.centralBankGovernmentBonds+=centralAmount;left-=centralAmount;issued+=centralAmount}
    if(issued>0){let cohort=government.debtCohorts.find(c=>c.issueMonth===monthIndex);if(!cohort){const draw=keyedUnit('bond-term',monthIndex),term=draw<.30?24:draw<.72?60:120,termPremium=term===24?.35:term===60?.65:1;cohort={principal:0,coupon:Math.max(.25,Number($('interestRate').value)+termPremium+sovereignRiskPremium()),monthsRemaining:term,issueMonth:monthIndex};government.debtCohorts.push(cohort)}cohort.principal+=issued}government.debt+=issued;government.newBorrowing+=issued;return issued
  }`);
replaceFunction('governmentFinance',`function governmentFinance(){
    updateSovereignRisk();for(const cohort of government.debtCohorts)cohort.monthsRemaining--;let debtInterest=sum(government.debtCohorts.map(c=>c.principal*c.coupon/1200)),matured=sum(government.debtCohorts.filter(c=>c.monthsRemaining<=0).map(c=>c.principal));ensureGovernmentCash(debtInterest);if(government.cash<debtInterest*.75&&government.debt>annualGDPReference()*1.4){restructureSovereignDebt('Government could not meet scheduled interest payments');debtInterest=sum(government.debtCohorts.map(c=>c.principal*c.coupon/1200));matured=sum(government.debtCohorts.filter(c=>c.monthsRemaining<=0).map(c=>c.principal))}
    const govtBank=bankById(government.bankId),totalHeld=sum(activeBanks().map(b=>b.bonds))+world.centralBankGovernmentBonds,interestBudget=Math.min(government.cash,debtInterest);let interestPaid=0;
    for(const b of activeBanks()){const due=totalHeld>0?interestBudget*b.bonds/totalHeld:0,paid=b.id===government.bankId?due:settleBankPayment(govtBank,b,due);if(paid>0){b.monthInterest+=paid;interestPaid+=paid}}
    const centralDue=totalHeld>0?interestBudget*world.centralBankGovernmentBonds/totalHeld:interestBudget,centralPaid=Math.min(centralDue,Math.max(0,govtBank?.reserves||0));if(centralPaid>0){govtBank.reserves-=centralPaid;interestPaid+=centralPaid}government.cash-=interestPaid;government.interestSpending+=interestPaid;
    function redeem(amount){if(amount<=0)return 0;const held=sum(activeBanks().map(b=>b.bonds))+world.centralBankGovernmentBonds;if(held<=0)return 0;let remaining=amount,paidTotal=0;for(const b of activeBanks().filter(b=>b.bonds>0)){const due=Math.min(b.bonds,amount*b.bonds/held,remaining),paid=b.id===government.bankId?due:settleBankPayment(govtBank,b,due);if(paid<=0)continue;b.bonds-=paid;remaining-=paid;paidTotal+=paid}if(remaining>0){const paid=Math.min(remaining,world.centralBankGovernmentBonds,Math.max(0,govtBank?.reserves||0));world.centralBankGovernmentBonds-=paid;if(govtBank)govtBank.reserves-=paid;remaining-=paid;paidTotal+=paid}return paidTotal}
    if(matured>0){const rollover=issueDebt(matured),payable=Math.min(matured,government.cash),paid=redeem(payable),residual=Math.max(0,matured-paid);government.cash-=paid;government.debt=Math.max(0,government.debt-paid);government.debtRepaid+=paid;government.debtCohorts=government.debtCohorts.filter(c=>c.monthsRemaining>0&&c.principal>.01);if(residual>.01)government.debtCohorts.push({principal:residual,coupon:Math.max(.25,Number($('interestRate').value)+sovereignRiskPremium()+3),monthsRemaining:12,issueMonth:monthIndex,arrears:true});if(paid<matured*.75&&rollover<matured*.75)restructureSovereignDebt('Government could not refinance maturing debt')}
    const reserveTarget=monthlyGovernmentSpending()*Math.max(1,Number($('cashReserveMonths').value));if(government.cash>reserveTarget&&government.debt>0){const wanted=Math.min(government.cash-reserveTarget,government.debt*.025),paid=redeem(wanted);government.cash-=paid;government.debt-=paid;government.debtRepaid+=paid;let left=paid;government.debtCohorts.sort((a,b)=>b.coupon-a.coupon);for(const c of government.debtCohorts){const cut=Math.min(c.principal,left);c.principal-=cut;left-=cut;if(left<=0)break}government.debtCohorts=government.debtCohorts.filter(c=>c.principal>.01)}
    if(government.debt<1&&government.cash>reserveTarget*1.5&&households.length){const excess=government.cash-reserveTarget*1.25,rebate=Math.min(excess*.125,annualGDPReference()/120),weights=households.map(h=>1/(1+householdNetWealth(h)/Math.max(1,annualGDPReference()/households.length))),total=sum(weights);for(let i=0;i<households.length;i++)governmentTransfer(households[i],rebate*weights[i]/Math.max(.001,total),'benefitSpending')}
  }`);
replaceFunction('initialiseBankBalanceSheets',`function initialiseBankBalanceSheets(){
    const requirement=Math.max(.04,Number($('capitalRequirement').value)/100);
    for(const bank of activeBanks()){const deposits=bankDeposits(bank.id),loans=bankFirmLoans(bank.id)+bankMortgages(bank.id),targetEquity=Math.max(150000*nominalScale(),loans*Math.max(.15,requirement+.05)),raw=deposits+targetEquity-loans-(bank.bonds||0),buffer=Math.max(35000*nominalScale(),deposits*.07);if(raw>=buffer){bank.reserves=raw;bank.centralBankBorrowing=0}else{bank.reserves=buffer;bank.centralBankBorrowing=Math.max(0,buffer-raw)}bank.resolutionProvision=bankResolutionLossBuffer(bank);bank.liquidityArrears=0;bank.insolvencyMonths=0;bank.liquidityDistressMonths=0}
  }`);
replaceFunction('wipeAllBorrowerDebt',`function wipeAllBorrowerDebt(){
    let total=0;total+=government.debt||0;government.debt=0;government.debtCohorts=[];for(const b of activeBanks())b.bonds=0;world.centralBankGovernmentBonds=0;
    for(const f of firms){total+=f.debt||0;f.debt=0;f.lenderBankId=null;f.interestArrears=0;f.missedPayments=0;f.nonPerformingMonths=0}
    for(const l of landlords){total+=l.debt||0;l.debt=0;l.lenderBankId=null;l.interestArrears=0;l.missedPayments=0;l.nonPerformingMonths=0}
    total+=developer.debt||0;developer.debt=0;developer.lenderBankId=null;developer.interestArrears=0;developer.missedPayments=0;developer.nonPerformingMonths=0;
    for(const u of housingUnits){total+=u.mortgageBalance||0;u.mortgageBalance=0;u.mortgageBankId=null;u.mortgageMonthsRemaining=0;u.repossessingBankId=null;u.arrears=0}
    if(world.netInternationalInvestmentPosition<0){total+=-world.netInternationalInvestmentPosition;world.netInternationalInvestmentPosition=0}invalidateBankBalanceCache();return total
  }`);
replaceFunction('applyUninsuredDepositBailIn',`function applyUninsuredDepositBailIn(customers,requested){
    const guarantee=clamp(Number($('depositGuarantee').value)/100,0,1),capacities=customers.map(customer=>({customer,capacity:customer===government?0:Math.max(0,customer.cash||0)*(1-guarantee)})),total=sum(capacities.map(x=>x.capacity)),amount=Math.min(Math.max(0,requested),total);if(amount<=0||total<=0)return 0;
    for(const item of capacities)item.customer.cash=Math.max(0,(item.customer.cash||0)-amount*item.capacity/total);invalidateBankBalanceCache();return amount
  }`);
replaceFunction('applyResidualResolutionLosses',`function applyResidualResolutionLosses(customers,requested){
    let remaining=Math.max(0,requested),governmentDepositLoss=0,insuredDepositLoss=0;if(remaining<=.01)return{governmentDepositLoss,insuredDepositLoss,remaining:0};
    if(customers.includes(government)&&government.cash>0){governmentDepositLoss=Math.min(remaining,government.cash);government.cash-=governmentDepositLoss;government.bankResolutionDepositLosses=(government.bankResolutionDepositLosses||0)+governmentDepositLoss;government.cumulativeBankResolutionDepositLosses=(government.cumulativeBankResolutionDepositLosses||0)+governmentDepositLoss;remaining-=governmentDepositLoss}
    const privateCustomers=customers.filter(x=>x!==government&&(x.cash||0)>0),capacity=sum(privateCustomers.map(x=>Math.max(0,x.cash||0)));insuredDepositLoss=Math.min(remaining,capacity);if(insuredDepositLoss>0&&capacity>0){for(const customer of privateCustomers)customer.cash=Math.max(0,customer.cash-insuredDepositLoss*Math.max(0,customer.cash)/capacity);government.depositGuaranteeShortfall=(government.depositGuaranteeShortfall||0)+insuredDepositLoss;government.cumulativeDepositGuaranteeShortfall=(government.cumulativeDepositGuaranteeShortfall||0)+insuredDepositLoss;remaining-=insuredDepositLoss}invalidateBankBalanceCache();return{governmentDepositLoss,insuredDepositLoss,remaining:Math.max(0,remaining)}
  }`);
replaceFunction('stabiliseResolvedBank',`function stabiliseResolvedBank(bank,customers,target){
    let gap=Math.max(0,-bankEquity(bank)),governmentDepositLoss=0,insuredDepositLoss=0,remaining=gap,governmentSupport=0;if(gap>0){if($('bankPolicy').value==='noSupport'){const losses=applyResidualResolutionLosses(customers,gap);governmentDepositLoss=losses.governmentDepositLoss;insuredDepositLoss=losses.insuredDepositLoss;remaining=losses.remaining}else{governmentSupport=v0112ResolutionCapital(bank,gap,'deposit-guarantee resolution support');remaining=Math.max(0,-bankEquity(bank));if(remaining>0){const losses=applyResidualResolutionLosses(customers,remaining);governmentDepositLoss=losses.governmentDepositLoss;insuredDepositLoss=losses.insuredDepositLoss;remaining=losses.remaining}}}
    return{governmentDepositLoss,insuredDepositLoss,remaining,centralBankWriteDown:0,centralBankBackstop:0,governmentSupport,finalEquity:bankEquity(bank),finalCapitalRatio:bankCapitalRatio(bank)}
  }`);
replaceFunction('suitableBankAcquirer',`function suitableBankAcquirer(excludeId,name='Successor Bank'){
    const requirement=Math.max(.04,Number($('capitalRequirement').value)/100);let acquirer=activeBanks().filter(b=>b.id!==excludeId&&bankEquity(b)>0&&bankCapitalRatio(b)>=requirement).sort((a,b)=>(bankEquity(b)+Math.max(0,b.reserves||0))-(bankEquity(a)+Math.max(0,a.reserves||0)))[0];if(acquirer)return acquirer;
    acquirer=createBank($('bankPolicy').value==='noSupport'?'Depositor Mutual '+(nextBankId+1):name,true);acquirer.mutualResolution=$('bankPolicy').value==='noSupport';banks.push(acquirer);entries++;const raised=capitaliseNewBank(acquirer);if(raised<=0){acquirer.active=true;acquirer.failedEntry=false;acquirer.reserves=0;acquirer.centralBankBorrowing=0;acquirer.shareholders=[];acquirer.entryRampMonths=24}invalidateBankBalanceCache();return acquirer
  }`);
replaceFunction('completeBankTransfer',`function completeBankTransfer(failed,successor,customers,target,details={}){
    transferBankRelationships(failed.id,successor.id);successor.reserves=(successor.reserves||0)+Math.max(0,failed.reserves||0);successor.bonds=(successor.bonds||0)+Math.max(0,failed.bonds||0);successor.centralBankBorrowing=(successor.centralBankBorrowing||0)+Math.max(0,failed.centralBankBorrowing||0);successor.publicResolutionEquity=(successor.publicResolutionEquity||0)+Math.max(0,failed.publicResolutionEquity||0);successor.resolutionProvision=Math.max(successor.resolutionProvision||0,details.recogniseImpairment?bankResolutionLossBuffer(successor):failed.resolutionProvision||0);
    failed.reserves=0;failed.bonds=0;failed.centralBankBorrowing=0;failed.resolutionProvision=0;failed.publicResolutionEquity=0;failed.active=false;exits++;invalidateBankBalanceCache();
    const finalLosses=stabiliseResolvedBank(successor,customers,target),restoration=v0112RestoreFacilityCompliance(successor),governmentSupport=(details.support||0)+(finalLosses.governmentSupport||0)+(restoration.governmentSupport||0);recordBankResolution({failedBank:failed.name,successorBank:successor.name,route:details.route||'resolution',openingEquity:details.openingEquity,openingDeposits:details.openingDeposits,openingAssets:details.openingAssets,uninsuredDepositLoss:details.bailIn||0,privateCapital:restoration.privateCapital||0,liquidityRepayment:restoration.liquidityRepayment||0,governmentSupport,priorBailoutSupport:details.priorBailoutSupport||0,recognisedImpairedAssets:Math.max(0,successor.resolutionProvision||0),...finalLosses,governmentSupport});return finalLosses
  }`);
replaceFunction('resolveBank',`function resolveBank(bank){
    if(!bank?.active)return;const bridgeEpisode=bank.name.startsWith('Bridge Bank'),selectedPolicy=$('bankPolicy').value,requirement=Math.max(.04,Number($('capitalRequirement').value)/100),openingEquity=bankEquity(bank),openingDeposits=bankDeposits(bank.id),openingAssets=bankAssets(bank),customers=bankCustomers(bank.id);if(!bridgeEpisode)failures++;resolvingBankId=bank.id;
    if(selectedPolicy==='bailout'&&!bridgeEpisode&&(bank.lastBailoutIndex===null||bank.lastBailoutIndex===undefined||monthIndex-bank.lastBailoutIndex>=120)){
      const target=Math.max(.14,requirement+.04),needed=Math.max(0,bankRWA(bank)*target-bankEquity(bank)),cap=Math.min(annualGDPReference()*.005,bankRWA(bank)*.15),baseSupport=governmentPaysBank(bank,Math.min(needed,cap),'bankSupportSpending');if(baseSupport>0)bank.publicResolutionEquity=(bank.publicResolutionEquity||0)+baseSupport;const restoration=v0112RestoreFacilityCompliance(bank),support=baseSupport+(restoration.governmentSupport||0);
      if(restoration.compliant&&bankEquity(bank)>=0&&bankCapitalRatio(bank)>=requirement){bank.lastBailoutIndex=monthIndex;bank.supportPlanMonths=120;bank.resolutionCooldown=36;bank.insolvencyMonths=0;bank.underCapitalMonths=0;recordBankResolution({failedBank:bank.name,successorBank:bank.name,route:'bailout',openingEquity,openingDeposits,openingAssets,privateCapital:restoration.privateCapital||0,liquidityRepayment:restoration.liquidityRepayment||0,governmentSupport:support,centralBankBackstop:0,finalEquity:bankEquity(bank),finalCapitalRatio:bankCapitalRatio(bank)});resolvingBankId=null;return}
    }
    const insolvency=Math.max(0,-bankEquity(bank)),bailIn=applyUninsuredDepositBailIn(customers,insolvency);let residual=Math.max(0,insolvency-bailIn),preSupport=0;
    if(residual>0&&selectedPolicy!=='noSupport')preSupport=v0112ResolutionCapital(bank,residual,'deposit-guarantee support before transfer');
    residual=Math.max(0,-bankEquity(bank));if(residual>0)applyResidualResolutionLosses(customers,residual);
    if(bridgeEpisode){const acquirer=suitableBankAcquirer(bank.id,'Resolution Successor Bank'),losses=completeBankTransfer(bank,acquirer,customers,0,{route:'bridge sale',openingEquity,openingDeposits,openingAssets,bailIn,support:preSupport,recogniseImpairment:true});lastBankResolutionText='Bridge bank sold after resolution';resolvingBankId=null;return losses}
    if(selectedPolicy==='noSupport'){
      const acquirer=suitableBankAcquirer(bank.id,'Private Resolution Successor'),losses=completeBankTransfer(bank,acquirer,customers,0,{route:'unsupported closure',openingEquity,openingDeposits,openingAssets,bailIn,support:0,recogniseImpairment:true});lastBankResolutionText='Unsupported closure with depositor loss allocation';resolvingBankId=null;return losses
    }
    const bridge=createBank('Bridge Bank '+(bank.id+1),false);bridge.resolutionCooldown=60;bridge.shareholders=[];banks.push(bridge);entries++;const losses=completeBankTransfer(bank,bridge,customers,0,{route:'bridge resolution',openingEquity,openingDeposits,openingAssets,bailIn,support:preSupport,recogniseImpairment:true}),seedNeed=Math.max(0,bankRWA(bridge)*.025-bankEquity(bridge)),seed=v0112ResolutionCapital(bridge,seedNeed,'temporary bridge equity');if(seed>0)recordBankResolution({bankId:bridge.id,bankName:bridge.name,route:'temporary bridge equity',governmentSupport:seed,centralBankBackstop:0});lastBankResolutionText='Bridge resolution with '+money(bailIn)+' uninsured-deposit bail-in and '+money(preSupport+seed)+' temporary public support';resolvingBankId=null;return losses
  }`);

replaceFunction('updateBanks',`function updateBanks(){
    invalidateBankBalanceCache();const requirement=Math.max(.04,Number($('capitalRequirement').value)/100),targetCapital=Math.max(.14,requirement+.04),reserveRate=Math.max(0,Number($('interestRate').value)-.25)/1200;
    for(const bank of activeBanks().slice()){
      bank.age++;if(bank.resolutionCooldown>0)bank.resolutionCooldown--;if(bank.entryRampMonths>0)bank.entryRampMonths--;if(bank.supportPlanMonths>0)bank.supportPlanMonths--;bank.resolutionProvision=bankResolutionLossBuffer(bank);
      if(bank.reserves<0){const deficit=-bank.reserves;bank.reserves=0;const drawn=drawCentralBankLiquidity(bank,deficit);bank.liquidityArrears=(bank.liquidityArrears||0)+Math.max(0,deficit-drawn)}
      const deposits=Math.max(0,bankDeposits(bank.id)),reserveTarget=Math.max(12000*nominalScale(),deposits*.055);if(bank.centralBankBorrowing>0&&bank.reserves>reserveTarget){const repay=Math.min(bank.centralBankBorrowing,(bank.reserves-reserveTarget)*.60);bank.reserves-=repay;bank.centralBankBorrowing-=repay}
      const cbDue=Math.max(0,bank.centralBankBorrowing||0)*(Number($('interestRate').value)+1)/1200,cbPaid=Math.min(cbDue,Math.max(0,bank.reserves-reserveTarget*.25));bank.reserves-=cbPaid;bank.monthCosts+=cbPaid;bank.liquidityArrears=Math.max(0,(bank.liquidityArrears||0)+cbDue-cbPaid-cbPaid*.05);
      const eligibleReserves=Math.min(Math.max(0,bank.reserves-bank.centralBankBorrowing),Math.max(reserveTarget*2,annualGDPReference()*.03)),reserveInterest=eligibleReserves*reserveRate;bank.reserves+=reserveInterest;bank.monthInterest+=reserveInterest;recordReserveInterestCost(reserveInterest);
      const depositRate=Math.max(0,Number($('interestRate').value)-2.25)/1200,depositors=[...households,...firms,...landlords,developer].filter(Boolean).filter(x=>x.bankId===bank.id),promised=sum(depositors.map(x=>Math.max(0,x.cash||0)*depositRate)),budget=Math.min(promised,Math.max(0,bank.monthInterest*.72+Math.max(0,bankEquity(bank)-bankRWA(bank)*targetCapital)*.00025));
      for(const entity of depositors){const gross=promised>0?budget*Math.max(0,entity.cash||0)*depositRate/promised:0,isHousehold=isHouseholdAgent(entity),taxDue=isHousehold?gross*Number($('investmentTax').value)/100:0,taxPaid=taxDue>0?bankPaysEntity(bank.id,government,taxDue):0,net=Math.max(0,gross-taxPaid);entity.cash+=net;bank.monthCosts+=net+taxPaid;if(taxPaid>0)recordTax(taxPaid,'investmentTaxRevenue')}
      invalidateBankBalanceCache();const operating=bankOperatingCost(bank),recipients=households.filter(h=>h.labourParticipant).sort((a,b)=>a.id-b.id).slice(0,Math.min(8,households.length));let operatingPaid=0;if(recipients.length){const each=operating/recipients.length;for(const h of recipients)operatingPaid+=bankPaysEntity(bank.id,h,each)}bank.monthCosts+=operatingPaid;invalidateBankBalanceCache();
      const equity=bankEquity(bank),capital=bankCapitalRatio(bank),liquidity=bankLiquidityStress(bank);bank.lossMonths=bank.monthInterest+reserveInterest<bank.monthCosts?bank.lossMonths+1:Math.max(0,bank.lossMonths-1);bank.liquidityDistressMonths=liquidity>.80?bank.liquidityDistressMonths+1:Math.max(0,bank.liquidityDistressMonths-1);bank.underCapitalMonths=capital<requirement?bank.underCapitalMonths+1:Math.max(0,bank.underCapitalMonths-1);bank.insolvencyMonths=equity<0?bank.insolvencyMonths+1:Math.max(0,bank.insolvencyMonths-1);
      if(bank.underCapitalMonths>=4&&bank.insolvencyMonths===0&&bank.resolutionCooldown===0){const gap=Math.max(0,bankRWA(bank)*targetCapital-bankEquity(bank)),raised=v0112RaisePrivateBankCapital(bank,Math.min(gap,Math.max(250000*nominalScale(),bankRWA(bank)*.08)),false);if(raised>0){privateRecaps++;bank.underCapitalMonths=Math.max(0,bank.underCapitalMonths-3);bank.resolutionCooldown=12}}
      if(bank.name.startsWith('Bridge Bank')&&bank.age>=48){const acquirer=activeBanks().filter(b=>b.id!==bank.id&&!b.name.startsWith('Bridge Bank')&&bankEquity(b)>0&&bankCapitalRatio(b)>=requirement).sort((a,b)=>bankCapitalRatio(b)-bankCapitalRatio(a))[0];if(acquirer||bank.age>=60){if(acquirer){const customers=bankCustomers(bank.id);completeBankTransfer(bank,acquirer,customers,0,{route:'bridge sale',openingEquity:bankEquity(bank),openingDeposits:bankDeposits(bank.id),openingAssets:bankAssets(bank),bailIn:0,support:0,recogniseImpairment:true});continue}else{bank.resolutionCooldown=0;bank.name='Depositor Mutual '+bank.id;bank.mutualResolution=true;bank.shareholders=[...new Set(bankCustomers(bank.id).filter(isHouseholdAgent).map(h=>h.id))].slice(0,40)}}}
      const facilityLimit=centralBankLiquidityLimit(bank),facilityBreach=(bank.centralBankBorrowing||0)>facilityLimit+Math.max(.01,facilityLimit*1e-9),restoration=facilityBreach?v0112RestoreFacilityCompliance(bank):{compliant:true,privateCapital:0,governmentSupport:0,liquidityRepayment:0};if(facilityBreach&&(restoration.privateCapital>0||restoration.governmentSupport>0||restoration.liquidityRepayment>0))recordBankResolution({bankId:bank.id,bankName:bank.name,route:'collateralised liquidity restoration',privateCapital:restoration.privateCapital||0,governmentSupport:restoration.governmentSupport||0,liquidityRepayment:restoration.liquidityRepayment||0,centralBankBackstop:0});if(equity<-.01||!restoration.compliant){resolveBank(bank);continue}bank.quietMonths=deposits<12000*nominalScale()&&bankFirmLoans(bank.id)+bankMortgages(bank.id)<15000*nominalScale()?bank.quietMonths+1:0
    }
    const bankSet=activeBanks(),minimum=minimumBankCount(),preferred=preferredBankCount(),recentEntry=bankResolutionLedger.some(x=>String(x.route||'').includes('private entry')&&monthIndex-(x.monthIndex??-999)<12),entryChance=bankSet.length<minimum?.35:bankSet.length<preferred?Math.max(.01,endogenousBankEntryAnnualRate()/12):endogenousBankEntryAnnualRate()/12;
    if(households.length>=25&&bankSet.length<8&&!recentEntry&&randStream('banking')<entryChance){const entrant=createBank('New Bank '+(nextBankId+1),true);banks.push(entrant);invalidateBankBalanceCache();const raised=capitaliseNewBank(entrant);if(raised>0){entries++;recordBankResolution({bankId:entrant.id,bankName:entrant.name,route:'private entry',privateCapital:raised,centralBankBackstop:0,governmentSupport:0})}}
    const count=activeBanks().length,candidate=activeBanks().filter(b=>count>minimum&&!b.name.startsWith('Bridge Bank')&&b.age>36&&(b.quietMonths>12||b.underCapitalMonths>12)).sort((a,b)=>bankCapitalRatio(a)-bankCapitalRatio(b))[0];if(candidate){const acquirer=activeBanks().filter(b=>b.id!==candidate.id&&bankEquity(b)>0&&bankCapitalRatio(b)>=requirement).sort((a,b)=>bankCapitalRatio(b)-bankCapitalRatio(a))[0];if(acquirer){const customers=bankCustomers(candidate.id);completeBankTransfer(candidate,acquirer,customers,0,{route:'voluntary merger',openingEquity:bankEquity(candidate),openingDeposits:bankDeposits(candidate.id),openingAssets:bankAssets(candidate),bailIn:0,support:0});lastBankResolutionText=candidate.name+' merged into '+acquirer.name}}
    for(const bank of activeBanks()){
      const reserveTarget=Math.max(12000*nominalScale(),bankDeposits(bank.id)*.055),publicClaim=Math.max(0,bank.publicResolutionEquity||0),excess=Math.max(0,bankEquity(bank)-bankRWA(bank)*Math.max(.16,requirement+.06)),cash=Math.max(0,bank.reserves-reserveTarget);if(publicClaim>0&&excess>0&&cash>0){const recovery=Math.min(publicClaim,excess*.35,cash*.35),source=bankById(government.bankId),paid=source&&source.id!==bank.id?settleBankPayment(bank,source,recovery):recovery;if(paid>0){bank.publicResolutionEquity-=paid;government.cash+=paid;government.bankSupportRecovery=(government.bankSupportRecovery||0)+paid;world.centralBankResolutionRecoveries=(world.centralBankResolutionRecoveries||0)+paid}}
      const remaining=Math.max(0,bankEquity(bank)-bankRWA(bank)*Math.max(.17,requirement+.07)),dividend=Math.min(remaining*.012,Math.max(0,bank.reserves-reserveTarget)*.02);if(dividend>0&&bank.shareholders?.length){const each=dividend/bank.shareholders.length;for(const id of bank.shareholders){const h=householdById(id);if(h)bankPaysEntity(bank.id,h,each);else if(id===FOREIGN_OWNER_ID){const paid=Math.min(each,Math.max(0,bank.reserves));bank.reserves-=paid;world.netInternationalInvestmentPosition-=paid;recordExternalFlow('out',paid,'foreign bank shareholder distribution','bank')}}}
    }
    archiveInactiveBanks();invalidateBankBalanceCache()
  }`);

replaceFunction('v0111MonetaryGuard',`function v0111MonetaryGuard(stage){
    const gdp=Math.max(1,annualGDPReference()),credit=totalPrivateBankCredit(),limit=privateCreditLimit(),badBank=activeBanks().find(b=>![b.reserves,b.centralBankBorrowing,bankAssets(b),bankEquity(b),bankDeposits(b.id)].every(Number.isFinite)),badBorrower=[...firms,...landlords,developer].filter(Boolean).find(x=>![x.cash,x.debt].every(Number.isFinite)),badReserve=activeBanks().find(b=>b.reserves<-.01||b.centralBankBorrowing<-0.01),cashMax=Math.max(0,...households.map(h=>Math.max(0,h.cash||0)));let problem='';if(badBank)problem='Non-finite bank balance';else if(badBorrower)problem='Non-finite borrower balance';else if(badReserve)problem='Negative bank reserve or liquidity liability';else if(credit>limit*1.001)problem='Private credit exceeded binding model limit';else if(cashMax>gdp*18)problem='Household cash detached from economy';if(!problem)return true;
    const offender=badBank||badReserve||activeBanks().slice().sort((a,b)=>(bankFirmLoans(b.id)+bankMortgages(b.id))-(bankFirmLoans(a.id)+bankMortgages(a.id)))[0]||null;world.firstMonetaryInvariant=world.firstMonetaryInvariant||{index:monthIndex,date:date().label,stage,problem,privateCredit:credit,privateCreditLimit:limit,gdp,bank:offender?{id:offender.id,name:offender.name,reserves:offender.reserves,deposits:bankDeposits(offender.id),equity:bankEquity(offender),centralBankBorrowing:offender.centralBankBorrowing,liquidityLimit:centralBankLiquidityLimit(offender),loans:bankFirmLoans(offender.id)+bankMortgages(offender.id),loanRate:loanRate(offender)}:null};modelHalted=true;modelTerminalReason='Monetary invariant failed during '+stage+': '+problem;lastInvariantProblems=[modelTerminalReason];running=false;return false
  }`);

replaceFunction('v011RunLongAudit',`function v011RunLongAudit(months=1200,seed=42){
    const settings=collectPolicySettings(),startingSeed=Number($('seed').value)||42,wasSuppress=suppressRendering;running=false;clearInterval(timer);suppressRendering=true;$('seed').value=String(seed);reset();let oneBankMonths=0,belowMinimumMonths=0,maxConsecutiveOneBank=0,currentOneBank=0,maxBridgeAge=0,minBanks=Infinity,bankMonths=0,maxCreditRatio=0,maxSingleBankCreditRatio=0,maxLiquidityUsage=0;
    try{for(let m=0;m<months&&!modelHalted;m++){if(politics?.pendingElection&&!resolvePendingElectionForAutomation())break;stepSimulation();if(politics?.pendingElection&&!resolvePendingElectionForAutomation())break;const live=activeBanks(),count=live.length;bankMonths+=count;minBanks=Math.min(minBanks,count);if(count===1&&minimumBankCount()>1){oneBankMonths++;currentOneBank++;maxConsecutiveOneBank=Math.max(maxConsecutiveOneBank,currentOneBank)}else currentOneBank=0;if(count<minimumBankCount())belowMinimumMonths++;for(const b of live){if(b.name.startsWith('Bridge Bank'))maxBridgeAge=Math.max(maxBridgeAge,b.age||0);const book=bankFirmLoans(b.id)+bankMortgages(b.id);maxSingleBankCreditRatio=Math.max(maxSingleBankCreditRatio,book/Math.max(1,annualGDPReference()));const lim=centralBankLiquidityLimit(b);if(lim>0)maxLiquidityUsage=Math.max(maxLiquidityUsage,(b.centralBankBorrowing||0)/lim)}maxCreditRatio=Math.max(maxCreditRatio,totalPrivateBankCredit()/Math.max(1,annualGDPReference()))}
      const successfulPrivate=[...banks,...bankArchive].filter(b=>String(b.name||'').startsWith('New Bank')&&!b.failedEntry),publicClaim=sum(activeBanks().map(b=>Math.max(0,b.publicResolutionEquity||0))),routes=bankResolutionLedger.slice(),sumField=field=>sum(routes.map(x=>Math.max(0,Number(x[field])||0))),finalGDP=Math.max(1,annualGDPReference()),last=history.at(-1),forensic={snapshot:last?{label:last.label,realGDPIndex:last.realGDPIndex,employmentRate:last.employmentRate,productivityTrend:last.productivityTrend,hardship:last.hardship,debtRatio:last.debtRatio}:null,banks:activeBanks().map(b=>({id:b.id,name:b.name,reserves:b.reserves,deposits:bankDeposits(b.id),equity:bankEquity(b),capitalRatio:bankCapitalRatio(b),loans:bankFirmLoans(b.id)+bankMortgages(b.id),centralBankBorrowing:b.centralBankBorrowing,liquidityLimit:centralBankLiquidityLimit(b),loanRate:loanRate(b),nplRatio:bankNplRatio(b)})),privateCredit:totalPrivateBankCredit(),privateCreditLimit:privateCreditLimit(),firmCash:sum(firms.map(f=>Math.max(0,f.cash||0))),firmDebt:sum(firms.map(f=>Math.max(0,f.debt||0)))};return{monthsRequested:months,monthsCompleted:monthIndex,seed,halted:modelHalted,problems:collectRunChecks(),minBanks:Number.isFinite(minBanks)?minBanks:0,averageBanks:bankMonths/Math.max(1,monthIndex),oneBankMonths,belowMinimumMonths,maxConsecutiveOneBank,maxBridgeAge,successfulPrivateEntrants:new Set(successfulPrivate.map(b=>b.id)).size,failures,annualFailureRate:failures/Math.max(1,monthIndex/12),entries,exits,bankPolicy:$('bankPolicy').value,resolutionRoutes:routes,governmentSupport:sumField('governmentSupport'),centralBankSolvencySupport:sumField('centralBankBackstop'),uninsuredDepositLoss:sumField('uninsuredDepositLoss'),firstMonetaryInvariant:world.firstMonetaryInvariant||null,centralBankBackstop:world.centralBankResolutionBackstop||0,centralBankRecoveries:world.centralBankResolutionRecoveries||0,outstandingPublicResolutionEquity:publicClaim,finalAnnualGDP:finalGDP,supportToGDP:sumField('governmentSupport')/finalGDP,maxCreditRatio,maxSingleBankCreditRatio,maxLiquidityUsage,forensic,performance:typeof v66PerformanceSummary==='function'?v66PerformanceSummary():null,phasePerformance:JSON.parse(JSON.stringify(v011PhaseStats))}}
    finally{suppressRendering=wasSuppress;applyPolicySettings(settings);$('seed').value=String(startingSeed);reset();running=false;if(!suppressRendering&&history.at(-1))draw(history.at(-1));restartTimer()}
  }`);

insertAfterFunction('v011RunLongAudit',`
  async function v0112RunSettlementAudit(){
    const settings=collectPolicySettings(),startingSeed=Number($('seed').value)||42,wasSuppress=suppressRendering;running=false;clearInterval(timer);suppressRendering=true;$('seed').value='42';reset();
    try{
      const entities=[...households,...firms,...landlords,developer].filter(Boolean).filter(x=>x.cash>100&&bankById(x.bankId)?.active),payer=entities.find(x=>entities.some(y=>y.bankId!==x.bankId)),payee=entities.find(x=>payer&&x.bankId!==payer.bankId);if(!payer||!payee)return{passed:false,problem:'No cross-bank test pair'};
      const amount=Math.min(1000*nominalScale(),payer.cash*.05),from=bankById(payer.bankId),to=bankById(payee.bankId),before={payerCash:payer.cash,payeeCash:payee.cash,reserves:sum(activeBanks().map(b=>b.reserves)),liquidity:sum(activeBanks().map(b=>b.centralBankBorrowing))},paid=domesticTransfer(payer,payee,amount),after={payerCash:payer.cash,payeeCash:payee.cash,reserves:sum(activeBanks().map(b=>b.reserves)),liquidity:sum(activeBanks().map(b=>b.centralBankBorrowing))},tolerance=Math.max(.001,amount*1e-9),cashConserved=Math.abs((before.payerCash+before.payeeCash)-(after.payerCash+after.payeeCash))<=tolerance,reserveFundingReconciles=Math.abs((after.reserves-before.reserves)-(after.liquidity-before.liquidity))<=tolerance,deltasMatch=Math.abs((before.payerCash-after.payerCash)-paid)<=tolerance&&Math.abs((after.payeeCash-before.payeeCash)-paid)<=tolerance;
      return{passed:paid>0&&cashConserved&&reserveFundingReconciles&&deltasMatch,paid,cashConserved,reserveFundingReconciles,deltasMatch,fromBank:from.name,toBank:to.name}
    }finally{suppressRendering=wasSuppress;applyPolicySettings(settings);$('seed').value=String(startingSeed);reset();running=false;if(!suppressRendering&&history.at(-1))draw(history.at(-1));restartTimer()}
  }
`);
replaceOnce('expose 0.11.2 audit helpers',"if(window.__sim){window.__sim.runLongAudit=v011RunLongAudit;window.__sim.performancePhases=()=>JSON.parse(JSON.stringify(v011PhaseStats));window.__sim.minimumBankCount=minimumBankCount}","if(window.__sim){window.__sim.runLongAudit=v011RunLongAudit;window.__sim.runSettlementAudit=v0112RunSettlementAudit;window.__sim.performancePhases=()=>JSON.parse(JSON.stringify(v011PhaseStats));window.__sim.minimumBankCount=minimumBankCount}");

// The 0.11.1 runtime override silently reintroduced public successor capital. The core 0.11.2 function above is authoritative.
replaceBetween('remove 0.11.1 acquirer override','  const v011SuitableBankAcquirerLegacy=suitableBankAcquirer;','  const v011ResetLegacy=reset;','');

replaceOnce('release title','<title>SimFlation 0.11.1</title>','<title>SimFlation 0.11.2</title>');
replaceOnce('edition badge','edition-badge">0.11.1<','edition-badge">0.11.2<');
replaceOnce('release pointer',"  window.__simflationCurrent=window.__simflation0111;","  window.__simflation0112={...window.__simflation0111,version:'0.11.2',releaseVersion:'0.11.2',modelVersion:'0.11.2'};\n  window.__simflationCurrent=window.__simflation0112;");
html=html.split("current.releaseVersion || '0.11.1'").join("current.releaseVersion || '0.11.2'");
replaceOnce('0.11.2 runtime marker','/* SimFlation 0.11.1 banking recovery and long-run performance release. */','/* SIMFLATION_0_11_2_RUNTIME_START */\n/* SimFlation 0.11.2 full banking, settlement and resolution release. */\n/* SimFlation 0.11.1 banking recovery and long-run performance release. */');

const forbiddenLegacy=[
  'if(gb.reserves<amount){gb.centralBankBorrowing+=amount-gb.reserves;gb.reserves=amount}',
  'if(pb&&pb.id!==bankId)pb.reserves-=amount',
  "credit>limit*1.28",
  "route:'system-stability bank'",
  "route:'bridge stabilisation'",
  "route:'one-off central-bank solvency recapitalisation'"
];
for(const marker of forbiddenLegacy)if(html.includes(marker))throw new Error(`Forbidden 0.11.1 banking path remains: ${marker}`);
const required=['SIMFLATION_0_11_2_RUNTIME_START','eligibleCentralBankCollateral','settleBankPayment','bankNplRatio','v0112RaisePrivateBankCapital','v0112ResolutionCapital','Private credit exceeded binding model limit','window.__simflation0112'];for(const marker of required)if(!html.includes(marker))throw new Error(`Required 0.11.2 marker missing: ${marker}`);
const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m=>m[1]);for(let i=0;i<scripts.length;i++)new vm.Script(scripts[i],{filename:`SimFlation-0.11.2-inline-${i+1}.js`});
const version={version:'0.11.2',label:'0.11.2',modelVersion:'0.11.2',standalone:'SimFlation-0.11.2.html',modelStandalone:'SimFlation-0.11.2.html'};
fs.writeFileSync(outputPath,html);fs.writeFileSync('index.html',html);fs.writeFileSync('version.json',JSON.stringify(version,null,2)+'\n');console.log(`Built ${outputPath}; ${scripts.length} inline scripts parsed successfully.`);

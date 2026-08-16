import fs from 'node:fs';
import vm from 'node:vm';

const sourcePath = 'SimFlation-v66.html';
const outputPath = 'SimFlation-v67.html';
let html = fs.readFileSync(sourcePath, 'utf8');

function replaceOnce(label, before, after) {
  const first = html.indexOf(before);
  if (first < 0) throw new Error(`Missing v67 patch target: ${label}`);
  if (html.indexOf(before, first + before.length) >= 0) throw new Error(`Non-unique v67 patch target: ${label}`);
  html = html.slice(0, first) + after + html.slice(first + before.length);
}

function replaceLine(label, needle, replacement) {
  const lines = html.split('\n');
  const matches = [];
  for (let i = 0; i < lines.length; i++) if (lines[i].includes(needle)) matches.push(i);
  if (matches.length !== 1) throw new Error(`Expected one line for ${label}, found ${matches.length}`);
  lines[matches[0]] = replacement;
  html = lines.join('\n');
}

// 1. Resolution provisioning: bridge banks recognise likely losses before those loans finally default.
replaceLine(
  'bank assets include resolution provision',
  'function bankAssets(bank){return bank.reserves+bankFirmLoans(bank.id)+bankMortgages(bank.id)+bank.bonds+bankRepossessed(bank.id)}',
  '  function bankAssets(bank){return bank.reserves+bankFirmLoans(bank.id)+bankMortgages(bank.id)+bank.bonds+bankRepossessed(bank.id)-(bank.resolutionProvision||0)}'
);
replaceOnce(
  'resolution loss buffer helper',
  "  function bankLiquidity(bank){const dep=bankDeposits(bank.id);return dep>0?bank.reserves/dep:1}\n",
  `  function bankLiquidity(bank){const dep=bankDeposits(bank.id);return dep>0?bank.reserves/dep:1}\n  function bankResolutionLossBuffer(bank){\n    if(!bank?.active)return 0;\n    const firmRisk=sum(firms.filter(f=>f.lenderBankId===bank.id&&(f.debt||0)>0).map(f=>{\n      const administration=f.administrationMonths||0,insolvency=f.insolvencyMonths||0,distress=f.distressMonths||0,losses=f.lossMonths||0;\n      const rate=administration>0?.35:insolvency>=3?.25:(distress>=6||losses>=18)?.12:(distress>=3||losses>=9)?.05:0;\n      return Math.max(0,f.debt||0)*rate\n    }));\n    const propertyRisk=sum([...landlords,developer].filter(x=>x.lenderBankId===bank.id&&(x.debt||0)>0).map(x=>Math.max(0,x.debt||0)*((x.nonPerformingMonths||0)>=6?.30:(x.missedPayments||0)>=3?.12:0)));\n    const mortgageRisk=sum(housingUnits.filter(u=>u.mortgageBankId===bank.id&&(u.mortgageBalance||0)>0).map(u=>Math.max(0,u.mortgageBalance||0)*((u.arrears||0)>=6?.20:(u.arrears||0)>=3?.08:0)));\n    return Math.min(bankRWA(bank)*.08,firmRisk+propertyRisk+mortgageRisk)\n  }\n`
);
replaceLine(
  'bank state includes resolution provision',
  'function createBank(name,entrant=false){return{id:nextBankId++',
  "  function createBank(name,entrant=false){return{id:nextBankId++,name:name||'Bank '+nextBankId,active:true,reserves:0,bonds:0,centralBankBorrowing:0,resolutionProvision:0,age:0,quietMonths:0,monthInterest:0,monthCosts:0,monthDefaults:0,resolutionCooldown:0,lastBailoutIndex:null,supportPlanMonths:0,emergencyBackstopUsed:false,distressMonths:0,underCapitalMonths:0,lossMonths:0,shareholders:households.length?generateShareholderSlots(16):[]}}"
);

// 2. Concentration limits and lending restrictions for banks in resolution/recovery.
replaceLine(
  'existing lender cannot lend during resolution cooldown',
  "let bank=borrower.lenderBankId!==null?bankById(borrower.lenderBankId):null;const recipientBank=bankById(borrower.bankId);if(!bank||!bank.active||bankCapitalRatio(bank)<Number($('capitalRequirement').value)/100||bankCreditCapacity(bank,1,recipientBank?.id)<=0)bank=chooseBank('loan');if(!bank)return 0;",
  "    let bank=borrower.lenderBankId!==null?bankById(borrower.lenderBankId):null;const recipientBank=bankById(borrower.bankId);if(!bank||!bank.active||bank.resolutionCooldown>0||bankCapitalRatio(bank)<Number($('capitalRequirement').value)/100||bankCreditCapacity(bank,1,recipientBank?.id)<=0)bank=chooseBank('loan');if(!bank)return 0;"
);
replaceLine(
  'single borrower concentration cap',
  "singleBorrowerLimit=type==='developer'?Math.max(180000*nominalScale(),bankEquity(bank)*.50):Math.max(110000*nominalScale(),bankEquity(bank)*.35)",
  "    const gdp=annualGDPReference(),revenueAnchor=Math.max(12000*nominalScale(),(borrower.expectedRevenue||20000*nominalScale())*15),economyBorrowerCap=gdp*(type==='developer'?.18:.10),broadLimit=Math.min(type==='developer'?Math.max(300000*nominalScale(),gdp*.12):Math.max(300000*nominalScale(),revenueAnchor),economyBorrowerCap),singleBorrowerLimit=type==='developer'?Math.max(0,bankEquity(bank)*.25):Math.max(0,bankEquity(bank)*.18),room=Math.max(0,Math.min(broadLimit,singleBorrowerLimit)-(borrower.debt||0));"
);

// 3. Protected deposits remain protected during an ordinary bank resolution.
replaceOnce(
  'resolution backstop protects guaranteed deposits',
  `  function stabiliseResolvedBank(bank,customers,target){\n    let gap=Math.max(0,bankRWA(bank)*target-bankEquity(bank));const residual=applyResidualResolutionLosses(customers,gap);gap=Math.max(0,bankRWA(bank)*target-bankEquity(bank));\n    const centralBankWriteDown=Math.min(Math.max(0,bank.centralBankBorrowing),gap);if(centralBankWriteDown>0){bank.centralBankBorrowing-=centralBankWriteDown;world.centralBankResolutionLosses=(world.centralBankResolutionLosses||0)+centralBankWriteDown;gap=Math.max(0,bankRWA(bank)*target-bankEquity(bank))}\n    const centralBankBackstop=Math.max(0,gap);if(centralBankBackstop>0){bank.reserves+=centralBankBackstop;world.centralBankResolutionBackstop=(world.centralBankResolutionBackstop||0)+centralBankBackstop}\n    return{...residual,centralBankWriteDown,centralBankBackstop,finalEquity:bankEquity(bank),finalCapitalRatio:bankCapitalRatio(bank)}\n  }`,
  `  function stabiliseResolvedBank(bank,customers,target){\n    let gap=Math.max(0,bankRWA(bank)*target-bankEquity(bank));\n    const centralBankWriteDown=Math.min(Math.max(0,bank.centralBankBorrowing),gap);if(centralBankWriteDown>0){bank.centralBankBorrowing-=centralBankWriteDown;world.centralBankResolutionLosses=(world.centralBankResolutionLosses||0)+centralBankWriteDown;gap=Math.max(0,bankRWA(bank)*target-bankEquity(bank))}\n    const centralBankBackstop=Math.max(0,gap);if(centralBankBackstop>0){bank.reserves+=centralBankBackstop;world.centralBankResolutionBackstop=(world.centralBankResolutionBackstop||0)+centralBankBackstop}\n    return{governmentDepositLoss:0,insuredDepositLoss:0,remaining:0,centralBankWriteDown,centralBankBackstop,finalEquity:bankEquity(bank),finalCapitalRatio:bankCapitalRatio(bank)}\n  }`
);

// 4. Transfer recognised problem-loan provisions with the portfolio and recapitalise after recognising them.
replaceOnce(
  'complete bank transfer carries provisions',
  `  function completeBankTransfer(failed,successor,customers,target,details={}){\n    transferBankRelationships(failed.id,successor.id);successor.reserves+=Math.max(0,failed.reserves);successor.bonds+=failed.bonds;successor.centralBankBorrowing+=failed.centralBankBorrowing;\n    failed.reserves=0;failed.bonds=0;failed.centralBankBorrowing=0;failed.active=false;exits++;\n    const finalLosses=stabiliseResolvedBank(successor,customers,target);recordBankResolution({failedBank:failed.name,successorBank:successor.name,route:details.route||'resolution',openingEquity:details.openingEquity,openingDeposits:details.openingDeposits,openingAssets:details.openingAssets,uninsuredDepositLoss:details.bailIn||0,governmentSupport:details.support||0,priorBailoutSupport:details.priorBailoutSupport||0,...finalLosses});\n    return finalLosses\n  }`,
  `  function completeBankTransfer(failed,successor,customers,target,details={}){\n    transferBankRelationships(failed.id,successor.id);successor.reserves+=Math.max(0,failed.reserves);successor.bonds+=failed.bonds;successor.centralBankBorrowing+=failed.centralBankBorrowing;\n    const inheritedProvision=Math.max(0,failed.resolutionProvision||0);successor.resolutionProvision=(successor.resolutionProvision||0)+inheritedProvision;const provisionBeforeRecognition=successor.resolutionProvision;if(details.recogniseImpairment)successor.resolutionProvision=Math.max(successor.resolutionProvision,bankResolutionLossBuffer(successor));const recognisedImpairedAssets=Math.max(0,successor.resolutionProvision-provisionBeforeRecognition);\n    failed.reserves=0;failed.bonds=0;failed.centralBankBorrowing=0;failed.resolutionProvision=0;failed.active=false;exits++;\n    const finalLosses=stabiliseResolvedBank(successor,customers,target);recordBankResolution({failedBank:failed.name,successorBank:successor.name,route:details.route||'resolution',openingEquity:details.openingEquity,openingDeposits:details.openingDeposits,openingAssets:details.openingAssets,uninsuredDepositLoss:details.bailIn||0,governmentSupport:details.support||0,priorBailoutSupport:details.priorBailoutSupport||0,recognisedImpairedAssets,...finalLosses});\n    return finalLosses\n  }`
);

// 5. A bridge bank is one resolution episode, with a stronger 20% post-resolution capital target.
replaceLine(
  'resolution episode counting and capital targets',
  'if(!bank?.active)return;failures++;resolvingBankId=bank.id;',
  "    if(!bank?.active)return;const bridgeEpisode=bank.name.startsWith('Bridge Bank');if(!bridgeEpisode)failures++;resolvingBankId=bank.id;"
);
replaceLine(
  'resolution target levels',
  "const selectedPolicy=$('bankPolicy').value,requirement=Number($('capitalRequirement').value)/100,baseTarget=Math.max(.10,requirement+.02),bailoutTarget=Math.max(.16,requirement+.06)",
  "    const selectedPolicy=$('bankPolicy').value,requirement=Number($('capitalRequirement').value)/100,baseTarget=Math.max(.14,requirement+.04),bridgeTarget=Math.max(.20,requirement+.10),bailoutTarget=Math.max(.16,requirement+.06),openingEquity=bankEquity(bank),openingDeposits=bankDeposits(bank.id),openingAssets=bankAssets(bank),customers=bankCustomers(bank.id);let priorBailoutSupport=0;"
);
replaceLine(
  'bridge sale target',
  "const acquirer=suitableBankAcquirer(bank.id,'Successor Bank'),capitalGap=Math.max(0,bankRWA(bank)*baseTarget-bankEquity(bank))",
  "        const acquirer=suitableBankAcquirer(bank.id,'Successor Bank'),saleTarget=acquirer.name.startsWith('National Stability Bank')?Math.max(.18,requirement+.08):baseTarget,capitalGap=Math.max(0,bankRWA(bank)*saleTarget-bankEquity(bank)),bailIn=applyUninsuredDepositBailIn(customers,capitalGap),support=governmentPaysBank(acquirer,Math.max(0,capitalGap-bailIn),'bankSupportSpending'),losses=completeBankTransfer(bank,acquirer,customers,saleTarget,{route:routePrefix+'bridge sale',openingEquity,openingDeposits,openingAssets,bailIn,support,priorBailoutSupport,recogniseImpairment:true});"
);
replaceLine(
  'new bridge bank capital target',
  'const capitalGap=Math.max(0,bankRWA(bank)*baseTarget-bankEquity(bank)),bailIn=applyUninsuredDepositBailIn(customers,capitalGap)',
  "      const capitalGap=Math.max(0,bankRWA(bank)*bridgeTarget-bankEquity(bank)),bailIn=applyUninsuredDepositBailIn(customers,capitalGap),support=governmentPaysBank(bridge,Math.max(0,capitalGap-bailIn),'bankSupportSpending'),losses=completeBankTransfer(bank,bridge,customers,bridgeTarget,{route:routePrefix+'bridge resolution',openingEquity,openingDeposits,openingAssets,bailIn,support,priorBailoutSupport,recogniseImpairment:true});bridge.resolutionCooldown=36;bridge.emergencyBackstopUsed=false;"
);

// 6. Banks target a normal 14% buffer. Bridge banks maintain 20% while they are being resolved.
replaceLine(
  'updateBanks target capital',
  "invalidateBankBalanceCache();const requirement=Number($('capitalRequirement').value)/100,targetCapital=Math.max(.12,requirement+.04);",
  "    invalidateBankBalanceCache();const requirement=Number($('capitalRequirement').value)/100,targetCapital=Math.max(.14,requirement+.04),bridgeTarget=Math.max(.20,requirement+.10);"
);
replaceLine(
  'refresh resolution provisions',
  'bank.age++;if(bank.resolutionCooldown>0)bank.resolutionCooldown--;if((bank.supportPlanMonths||0)>0)bank.supportPlanMonths--;',
  "      bank.age++;if(bank.resolutionCooldown>0)bank.resolutionCooldown--;if((bank.supportPlanMonths||0)>0)bank.supportPlanMonths--;const currentProvision=bankResolutionLossBuffer(bank);bank.resolutionProvision=bank.name.startsWith('Bridge Bank')&&bank.resolutionCooldown>0?currentProvision:Math.min(bank.resolutionProvision||0,currentProvision);"
);

// 7. Private recapitalisation is deterministic when funding exists, rather than a 70% random survival roll.
replaceLine(
  'deterministic private recapitalisation',
  "if(bank.resolutionCooldown===0&&(equity<0||cap<requirement&&bank.underCapitalMonths>=4)&&privateGap<=350000*nominalScale()&&randStream('banking')<.70)",
  "      if(bank.resolutionCooldown===0&&(equity<0||cap<requirement&&bank.underCapitalMonths>=4)&&privateGap<=Math.max(350000*nominalScale(),bankRWA(bank)*.10)){const raised=foreignBankRecap(bank,privateGap);if(bankAdequatelyCapitalised(bank,requirement)){privateRecaps++;bank.distressMonths=0;bank.underCapitalMonths=0;bank.resolutionCooldown=18;lastBankResolutionText=bank.name+' raised '+money(raised)+' of private capital'}else if(severe)resolveBank(bank)}"
);

// 8. Do not manufacture a fourth Stability Bank immediately after every failure.
replaceLine(
  'conditional stability bank entry',
  'const entryRate=endogenousBankEntryAnnualRate(),minimumBanks=households.length>=250?4:',
  `    const entryRate=endogenousBankEntryAnnualRate(),minimumBanks=households.length>=250?4:households.length>=100?3:households.length>=25?2:1,bankSet=activeBanks(),bridgeActive=bankSet.some(b=>b.name.startsWith('Bridge Bank')),lastFailureMonth=bankResolutionLedger.reduce((latest,row)=>{const route=String(row.route||'');return route.includes('bridge resolution')||route==='closure'||route==='bailout'?Math.max(latest,row.monthIndex??-999):latest},-999),shortageAge=monthIndex-lastFailureMonth,healthyBanks=bankSet.filter(b=>bankEquity(b)>0&&bankCapitalRatio(b)>=requirement).length,systemCapacity=sum(bankSet.map(b=>bankCreditCapacity(b,1,b.id))),urgentShortage=bankSet.length<Math.max(1,minimumBanks-1)||healthyBanks<Math.max(1,minimumBanks-1)||systemCapacity<annualGDPReference()*.025,stabilityNeeded=bankSet.length<minimumBanks&&!bridgeActive&&(urgentShortage||shortageAge>=24);if(stabilityNeeded){const expectedRWA=Math.max(annualGDPReference()*.02,totalPrivateBankCredit()/Math.max(1,bankSet.length+1)*.75),stabilityTarget=Math.max(.20,requirement+.10),capital=Math.max(500000*nominalScale(),expectedRWA*stabilityTarget),entrant=createBank('National Stability Bank '+(nextBankId+1),false);entrant.reserves=capital;entrant.resolutionCooldown=60;banks.push(entrant);world.centralBankResolutionBackstop=(world.centralBankResolutionBackstop||0)+capital;entries++;recordBankResolution({bankName:entrant.name,route:'system-stability bank',openingEquity:0,publicSupport:0,centralBankBackstop:capital,targetCapitalRatio:stabilityTarget})}else if(households.length>=25&&activeBanks().length<8&&randStream('banking')<entryRate/12){const entrant=createBank('New Bank '+(nextBankId+1),true);banks.push(entrant);if(capitaliseNewBank(entrant)>0)entries++}`
);

// 9. The final sweep now respects the distress window. Bridge banks are stabilised during cooldown unless a genuinely catastrophic fresh loss occurs.
replaceLine(
  'final insolvency sweep',
  'for(const bank of activeBanks().slice()){const equity=bankEquity(bank);if(equity<0){const gap=',
  `    for(const bank of activeBanks().slice()){\n      const equity=bankEquity(bank);if(equity>=0)continue;\n      const gap=Math.max(0,bankRWA(bank)*targetCapital-equity),smallGap=gap<=Math.max(12000*nominalScale(),bankRWA(bank)*.035),deposits=bankDeposits(bank.id),severe=equity<-Math.max(80000*nominalScale(),deposits*.20);\n      if(bank.name.startsWith('Bridge Bank')&&bank.resolutionCooldown>0){\n        const catastrophic=equity<-Math.max(250000*nominalScale(),deposits*.35);\n        if(!catastrophic){bank.resolutionProvision=bankResolutionLossBuffer(bank);const backstop=Math.max(0,bankRWA(bank)*bridgeTarget-bankEquity(bank));if(backstop>0){bank.reserves+=backstop;world.centralBankResolutionBackstop=(world.centralBankResolutionBackstop||0)+backstop}bank.distressMonths=0;bank.underCapitalMonths=0;bank.emergencyBackstopUsed=true;recordBankResolution({bankName:bank.name,route:'bridge stabilisation',openingEquity:equity,centralBankBackstop:backstop,finalEquity:bankEquity(bank),finalCapitalRatio:bankCapitalRatio(bank)});lastBankResolutionText=bank.name+' stabilised during resolution with '+money(backstop)+' of central-bank capital';continue}\n      }\n      const recapLimit=Math.max(450000*nominalScale(),bankRWA(bank)*.12);\n      if(bank.resolutionCooldown===0&&gap<=recapLimit){const raised=foreignBankRecap(bank,gap);if(bankAdequatelyCapitalised(bank,requirement)){privateRecaps++;bank.distressMonths=0;bank.underCapitalMonths=0;bank.resolutionCooldown=24;lastBankResolutionText=bank.name+' completed an emergency private recapitalisation of '+money(raised)}else if(smallGap){const backstop=Math.max(0,bankRWA(bank)*targetCapital-bankEquity(bank));bank.reserves+=backstop;world.centralBankResolutionBackstop=(world.centralBankResolutionBackstop||0)+backstop;bank.distressMonths=0;bank.underCapitalMonths=0;bank.resolutionCooldown=24;bank.emergencyBackstopUsed=true;recordBankResolution({bankName:bank.name,route:'temporary central-bank recapitalisation',openingEquity:equity,centralBankBackstop:backstop,finalEquity:bankEquity(bank),finalCapitalRatio:bankCapitalRatio(bank)});lastBankResolutionText=bank.name+' received a temporary central-bank recapitalisation of '+money(backstop)}else if(severe||bank.distressMonths>=12)resolveBank(bank);else lastBankResolutionText=bank.name+' entered a capital recovery plan'}\n      else if(smallGap&&!bank.emergencyBackstopUsed){const backstop=Math.max(0,bankRWA(bank)*targetCapital-bankEquity(bank));bank.reserves+=backstop;world.centralBankResolutionBackstop=(world.centralBankResolutionBackstop||0)+backstop;bank.distressMonths=0;bank.underCapitalMonths=0;bank.resolutionCooldown=24;bank.emergencyBackstopUsed=true;recordBankResolution({bankName:bank.name,route:'single temporary central-bank recapitalisation',openingEquity:equity,centralBankBackstop:backstop,finalEquity:bankEquity(bank),finalCapitalRatio:bankCapitalRatio(bank)})}\n      else if(severe||bank.distressMonths>=12)resolveBank(bank);\n      else lastBankResolutionText=bank.name+' entered a capital recovery plan'\n    }`
);

// 10. Exports and the canonical current-model pointer identify the generated build as v67.
replaceOnce(
  'current model pointer',
  "  window.__simflationV66={...legacy,version:'0.9.0',releaseVersion:'0.9.0',modelVersion:'v66'};\n  window.__simflationCurrent=window.__simflationV66;",
  "  window.__simflationV66={...legacy,version:'0.9.0',releaseVersion:'0.9.0',modelVersion:'v66'};\n  window.__simflationV67={...window.__simflationV66,modelVersion:'v67'};\n  window.__simflationCurrent=window.__simflationV67;"
);
html = html.replace('/* SimFlation v66 stability, performance, election-detail and interface upgrade. */', '/* SimFlation v67 banking stability build, based on the v66 interface/performance release. */\n/* SimFlation v66 stability, performance, election-detail and interface upgrade. */');

// Static parse check every inline script before publishing the generated build.
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
for (let i = 0; i < scripts.length; i++) new vm.Script(scripts[i], {filename:`SimFlation-v67-inline-${i + 1}.js`});

const version = {
  version: '0.9.0',
  label: '0.9.0',
  modelVersion: 'v67',
  standalone: 'SimFlation-0.9.0.html',
  modelStandalone: 'SimFlation-v67.html'
};

fs.writeFileSync(outputPath, html);
fs.writeFileSync('index.html', html);
fs.writeFileSync('SimFlation-0.9.0.html', html);
fs.writeFileSync('version.json', JSON.stringify(version, null, 2) + '\n');

console.log(`Built ${outputPath}; ${scripts.length} inline scripts parsed successfully.`);

import fs from 'node:fs';
import vm from 'node:vm';

const sourcePath = 'SimFlation-0.10.0.html';
const outputPath = 'SimFlation-0.11.0.html';
let html = fs.readFileSync(sourcePath, 'utf8');

function replaceOnce(label, before, after) {
  const first = html.indexOf(before);
  if (first < 0) throw new Error(`Missing 0.11.0 patch target: ${label}`);
  if (html.indexOf(before, first + before.length) >= 0) throw new Error(`Non-unique 0.11.0 patch target: ${label}`);
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

function replaceAllChecked(label, before, after, minimum = 1) {
  const count = html.split(before).length - 1;
  if (count < minimum) throw new Error(`Expected at least ${minimum} replacements for ${label}, found ${count}`);
  html = html.split(before).join(after);
  return count;
}

// ---------------------------------------------------------------------------
// SimFlation 0.11.0: constant-time hot-path identity checks and helper state.
// These declarations are installed before the model's first reset, so the
// optimised checks are safe during both initialisation and subsequent runs.
// ---------------------------------------------------------------------------
replaceOnce(
  '0.11.0 core helpers',
  "(() => {\n  'use strict';\n",
  `(() => {\n  'use strict';\n  // SimFlation 0.11.0 performance and banking helpers.\n  const v011AgentTypeCache=new WeakMap();\n  let v011EndedHouseholdIds=new Set(),v011ExitedPersonIds=new Set(),v011FormationIds=new Set(),v011DuplicateHouseholdFormation=false;\n  let v011MigrationStatsMonth=-1,v011MigrationStats=null;\n  function isHouseholdAgent(entity){\n    if(!entity||typeof entity!=='object')return false;\n    const cached=v011AgentTypeCache.get(entity);if(cached)return cached==='household';\n    let yes=false;try{yes=Number.isInteger(entity.id)&&householdIndex.get(entity.id)===entity}catch{}\n    if(yes)v011AgentTypeCache.set(entity,'household');return yes\n  }\n  function isFirmAgent(entity){\n    if(!entity||typeof entity!=='object')return false;\n    const cached=v011AgentTypeCache.get(entity);if(cached)return cached==='firm';\n    let yes=false;try{if(Number.isInteger(entity.id)){if(firmIndexLength!==firms.length)rebuildFirmCaches();yes=firmIndex.get(entity.id)===entity}}catch{}\n    if(yes)v011AgentTypeCache.set(entity,'firm');return yes\n  }\n  function minimumBankCount(){return households.length>=250?4:households.length>=100?3:households.length>=25?2:1}\n  function v011AdjustDepositCache(bankId,delta){\n    if(!bankBalanceCache||bankId===null||bankId===undefined||!delta)return;\n    const row=bankBalanceCache.get(bankId);if(!row){bankBalanceCache=null;return}row.deposits+=delta\n  }\n  function v011MigrationHouseholdStats(){\n    if(v011MigrationStatsMonth===monthIndex&&v011MigrationStats)return v011MigrationStats;\n    let recent=0,foreign=0,descendant=0,highSkill=0;\n    for(const h of households){\n      const members=householdPeople(h),first=members.filter(p=>(p.migrationGeneration||0)===1),hasFirst=first.length>0,hasDesc=!hasFirst&&members.some(p=>(p.migrationGeneration||0)>=2);\n      if(hasFirst){foreign++;if(first.some(p=>p.arrivalMonth!==null&&monthIndex-p.arrivalMonth<240))recent++;if(first.some(p=>p.ageMonths>=18*12&&p.skillLevel==='high'))highSkill++}\n      else if(hasDesc)descendant++\n    }\n    const n=Math.max(1,households.length);v011MigrationStats={recentShare:recent/n*100,foreignShare:foreign/n*100,descendantShare:descendant/n*100,highSkillShare:foreign?highSkill/foreign*100:0};v011MigrationStatsMonth=monthIndex;return v011MigrationStats\n  }\n`
);

// Replace linear array membership checks in the transaction hot path with O(1)
// identity checks backed by the model's existing household and firm indexes.
const householdIncludesReplaced = replaceAllChecked('household hot-path membership', 'households.includes(', 'isHouseholdAgent(', 4);
const firmIncludesReplaced = replaceAllChecked('firm hot-path membership', 'firms.includes(', 'isFirmAgent(', 2);

// ---------------------------------------------------------------------------
// Bank balance cache: keep deposit aggregates current for ordinary transfers.
// Structural balance-sheet changes can still invalidate and rebuild the cache.
// ---------------------------------------------------------------------------
replaceLine(
  'incremental bank switching cache',
  'function switchBank(entity,newId)',
  "  function switchBank(entity,newId){if(entity.bankId===newId)return;const oldId=entity.bankId,old=bankById(oldId),next=bankById(newId),cash=Math.max(0,entity.cash||0);if(old)old.reserves-=cash;if(next)next.reserves+=cash;if(bankBalanceCache){v011AdjustDepositCache(oldId,-cash);v011AdjustDepositCache(newId,cash)}entity.bankId=newId}"
);
replaceLine(
  'incremental domestic transfer cache',
  'function domesticTransfer(payer,payee,requested)',
  "  function domesticTransfer(payer,payee,requested){const amount=Math.min(Math.max(0,requested),Math.max(0,payer.cash));if(amount<=0)return 0;const payerBankId=payer.bankId,payeeBankId=payee.bankId;payer.cash-=amount;payee.cash+=amount;if(payerBankId!==payeeBankId){const pb=bankById(payerBankId),rb=bankById(payeeBankId);if(pb)pb.reserves-=amount;if(rb)rb.reserves+=amount;if(bankBalanceCache){v011AdjustDepositCache(payerBankId,-amount);v011AdjustDepositCache(payeeBankId,amount)}}return amount}"
);
replaceLine(
  'incremental external outflow cache',
  'function externalOut(payer,requested',
  "  function externalOut(payer,requested,reason='external payment',roomOverride=0){const amount=Math.min(Math.max(0,requested),Math.max(0,payer.cash),Math.max(externalPaymentRoom(),Math.max(0,roomOverride)));if(amount<=0)return 0;payer.cash-=amount;const bank=bankById(payer.bankId);if(bank)bank.reserves-=amount;if(bankBalanceCache)v011AdjustDepositCache(payer.bankId,-amount);world.netInternationalInvestmentPosition-=amount;recordExternalFlow('out',amount,reason,isHouseholdAgent(payer)?'household':isFirmAgent(payer)?'firm':'other');return amount}"
);
replaceLine(
  'incremental external inflow cache',
  'function externalIn(payee,amount',
  "  function externalIn(payee,amount,reason='external receipt'){if(amount<=0)return 0;payee.cash+=amount;const bank=bankById(payee.bankId);if(bank)bank.reserves+=amount;if(bankBalanceCache)v011AdjustDepositCache(payee.bankId,amount);world.netInternationalInvestmentPosition+=amount;recordExternalFlow('in',amount,reason,isHouseholdAgent(payee)?'household':isFirmAgent(payee)?'firm':'other');return amount}"
);
replaceLine(
  'incremental bank payment cache',
  'function bankPaysEntity(bankId,payee,amount)',
  "  function bankPaysEntity(bankId,payee,amount){const bank=bankById(bankId),recipient=bankById(payee.bankId);if(!bank||amount<=0)return 0;if(bank.id!==recipient?.id){bank.reserves-=amount;if(recipient)recipient.reserves+=amount}payee.cash+=amount;if(bankBalanceCache)v011AdjustDepositCache(payee.bankId,amount);return amount}"
);
replaceLine(
  'foreign capital cache correctness',
  'function foreignCapitalIn(payee,amount)',
  "  function foreignCapitalIn(payee,amount){if(amount<=0)return 0;const monthlyLimit=annualGDPReference()*(world.externalCrisisMonths>0?.0005:.006)*(1-(world.capitalControls||0)),allowed=Math.min(amount,externalFundingRoom(),monthlyLimit);if(allowed<=0)return 0;payee.cash+=allowed;const bank=bankById(payee.bankId);if(bank)bank.reserves+=allowed;if(bankBalanceCache)v011AdjustDepositCache(payee.bankId,allowed);world.netInternationalInvestmentPosition-=allowed;recordExternalFlow('in',allowed,'foreign capital liability',isFirmAgent(payee)?'firm':'other');return allowed}"
);

// ---------------------------------------------------------------------------
// Long-run integrity checking: use existing indexes and incremental archive sets
// instead of re-scanning every historical lifecycle record each month.
// ---------------------------------------------------------------------------
replaceAllChecked('housing integrity map lookup', '!housingUnits.find(u=>u.id===h.housingUnitId)', '!housingIndex.has(h.housingUnitId)', 1);
replaceOnce(
  'ended household integrity check',
  "for(const record of householdLifecycleHistory.filter(x=>x.endMonth!==null))if(activeHouseholdSet.has(record.id))problems.push('Ended household remains active')",
  "for(const h of households)if(v011EndedHouseholdIds.has(h.id))problems.push('Ended household remains active')"
);
replaceOnce(
  'household id reuse integrity check',
  "const formationRecords=householdLifecycleHistory.filter(x=>x.endMonth===null),formationIds=formationRecords.map(x=>x.id);if(new Set(formationIds).size!==formationIds.length)problems.push('A permanent household id was reused')",
  "if(v011DuplicateHouseholdFormation)problems.push('A permanent household id was reused')"
);
replaceOnce(
  'exited person integrity check',
  "for(const exit of personLifecycleHistory)if(personById(exit.id))problems.push('Exited person remains active')",
  "for(const p of people)if(v011ExitedPersonIds.has(p.id))problems.push('Exited person remains active')"
);
replaceOnce(
  'historical inheritance audit is periodic',
  "for(const event of inheritanceHistory){if(event.basis==='kinship'&&event.decedentPersonId!==null){const dec=globalThis.__simflationV64ArchivedPersonById(event.decedentPersonId);if(!dec)problems.push('Kinship inheritance has no archived decedent')}}",
  "if(monthIndex%12===0)for(const event of inheritanceHistory){if(event.basis==='kinship'&&event.decedentPersonId!==null){const dec=globalThis.__simflationV64ArchivedPersonById(event.decedentPersonId);if(!dec)problems.push('Kinship inheritance has no archived decedent')}}"
);

// ---------------------------------------------------------------------------
// History work whose cost previously increased with the age of the simulation.
// ---------------------------------------------------------------------------
replaceOnce(
  'constant-time previous-year completeness',
  "const previousYearMonths=history.filter(x=>x.year===s.year-1).length",
  "const previousYearMonths=history.length>=12?12:history.filter(x=>x.year===s.year-1).length"
);
replaceOnce(
  'current government history slice',
  "termData=history.filter(x=>x.index>=politics.termStartIndex)",
  "termData=history.slice(Math.max(0,politics.termStartIndex))"
);

// ---------------------------------------------------------------------------
// Demographic and snapshot scan consolidation.
// ---------------------------------------------------------------------------
replaceLine(
  'fertility estimate caches person rates',
  'function periodFertilityEstimate()',
  "  function periodFertilityEstimate(){const women=people.filter(p=>p.sex==='female'&&p.ageMonths>=18*12&&p.ageMonths<=45*12);if(!women.length)return 0;const rows=women.map(p=>({age:p.ageMonths/12,rate:fertilityAnnualRate(p,householdOfPerson(p))}));let total=0;for(let age=18;age<=45;age++){let weightedRate=0,weightTotal=0;for(const row of rows){const distance=(row.age-age)/3.5,weight=Math.exp(-distance*distance);weightedRate+=row.rate*weight;weightTotal+=weight}if(weightTotal>0)total+=weightedRate/weightTotal}return clamp(total,0,6)}"
);
replaceOnce(
  'recent immigrant household snapshot',
  "immigrantHouseholdShare:households.filter(h=>householdPeople(h).some(p=>(p.migrationGeneration||0)===1&&p.arrivalMonth!==null&&monthIndex-p.arrivalMonth<240)).length/Math.max(1,households.length)*100",
  "immigrantHouseholdShare:v011MigrationHouseholdStats().recentShare"
);
replaceOnce(
  'foreign born household snapshot',
  "foreignBornHouseholdShare:households.filter(h=>householdPeople(h).some(p=>(p.migrationGeneration||0)===1)).length/Math.max(1,households.length)*100",
  "foreignBornHouseholdShare:v011MigrationHouseholdStats().foreignShare"
);
replaceOnce(
  'descendant household snapshot',
  "descendantHouseholdShare:households.filter(h=>!householdPeople(h).some(p=>(p.migrationGeneration||0)===1)&&householdPeople(h).some(p=>(p.migrationGeneration||0)>=2)).length/Math.max(1,households.length)*100",
  "descendantHouseholdShare:v011MigrationHouseholdStats().descendantShare"
);
replaceOnce(
  'high skill immigrant household snapshot',
  "highSkillImmigrantShare:(()=>{const x=households.filter(h=>householdPeople(h).some(p=>(p.migrationGeneration||0)===1));return x.length?x.filter(h=>adultPeople(h).some(p=>(p.migrationGeneration||0)===1&&p.skillLevel==='high')).length/x.length*100:0})()",
  "highSkillImmigrantShare:v011MigrationHouseholdStats().highSkillShare"
);

// ---------------------------------------------------------------------------
// Housing market hot spots: calculate tenant-income anchor once per month and
// reuse sorted vacancy pools for homeless allocations.
// ---------------------------------------------------------------------------
replaceLine(
  'private rent affordability anchor',
  'const privatePressure=clamp((targetPrivateVacancy-privateVacancy)',
  "    const privatePressure=clamp((targetPrivateVacancy-privateVacancy)*2+privateApplicants/Math.max(1,privateUnits.length)*.35,-.45,.45),ownerPressure=clamp((targetOwnerVacancy-ownerVacancy)*1.6+ownerApplicants/Math.max(1,ownerUnits.length)*.25,-.45,.45),viableRent=Math.max(100*nominalScale(),sectorPrice('construction')*.05),requiredYield=Math.max(.025,(Number($('interestRate').value)+3.25)/100),privateTenantIncomeAnchor=(avg(households.filter(h=>unitOf(h)?.type==='private').map(h=>h.income))*.32)||0;"
);
replaceOnce(
  'rent loop uses cached affordability anchor',
  "const affordabilityAnchor=avg(households.filter(h=>unitOf(h)?.type==='private').map(h=>h.income))*.32||u.rent",
  "const affordabilityAnchor=privateTenantIncomeAnchor||u.rent"
);
replaceLine(
  'homeless private vacancy pool',
  "for(const h of households.filter(x=>x.housingUnitId===null)){const u=socialVac.shift();if(u){assignUnit(h,u);continue}const choices=housingUnits.filter(u=>u.type==='private'&&u.occupantId===null&&u.rent<Math.max(650*nominalScale(),h.income*.48+h.cash*.03)),r=choices.sort((a,b)=>a.rent-b.rent)[0];if(r)assignUnit(h,r)}",
  "    const v011PrivateVacant=housingUnits.filter(u=>u.type==='private'&&u.occupantId===null).sort((a,b)=>a.rent-b.rent);for(const h of households.filter(x=>x.housingUnitId===null)){const u=socialVac.shift();if(u){assignUnit(h,u);continue}const limit=Math.max(650*nominalScale(),h.income*.48+h.cash*.03),idx=v011PrivateVacant.findIndex(x=>x.occupantId===null&&x.rent<limit),r=idx>=0?v011PrivateVacant.splice(idx,1)[0]:null;if(r)assignUnit(h,r)}"
);
replaceLine(
  'post-conversion homeless vacancy pool',
  "for(const h of households.filter(x=>x.housingUnitId===null)){const r=housingUnits.filter(u=>u.type==='private'&&u.occupantId===null&&u.rent<Math.max(650*nominalScale(),h.income*.48+h.cash*.03)).sort((a,b)=>a.rent-b.rent)[0];if(r)assignUnit(h,r)}",
  "    const v011ConvertedVacant=housingUnits.filter(u=>u.type==='private'&&u.occupantId===null).sort((a,b)=>a.rent-b.rent);for(const h of households.filter(x=>x.housingUnitId===null)){const limit=Math.max(650*nominalScale(),h.income*.48+h.cash*.03),idx=v011ConvertedVacant.findIndex(u=>u.occupantId===null&&u.rent<limit),r=idx>=0?v011ConvertedVacant.splice(idx,1)[0]:null;if(r)assignUnit(h,r)}"
);
replaceLine(
  'annual housing review vacancy pools',
  'const annualReview=h=>((monthIndex+h.id)%12===0)||unitOf(h)?.arrears>0||h.job===null;',
  "    const annualReview=h=>((monthIndex+h.id)%12===0)||unitOf(h)?.arrears>0||h.job===null,v011ReviewHouseholds=households.filter(annualReview),v011ReviewPrivateVacant=housingUnits.filter(u=>u.type==='private'&&u.occupantId===null).sort((a,b)=>a.rent-b.rent),v011ReviewOwnerVacant=housingUnits.filter(u=>u.type==='owner'&&u.occupantId===null).sort((a,b)=>a.price-b.price);"
);
replaceLine(
  'annual private housing review uses vacancy pool',
  "for(const h of households.filter(annualReview)){const current=unitOf(h);if(current?.type==='social'&&h.housingPreference==='private'){const u=housingUnits.filter(x=>x.type==='private'&&x.occupantId===null&&x.rent<h.income*.36).sort((a,b)=>a.rent-b.rent)[0];if(u)assignUnit(h,u)}else if(current?.type==='private'&&current.rent>h.income*.40){const cheaper=housingUnits.filter(x=>x.type==='private'&&x.occupantId===null&&x.rent<current.rent*.88).sort((a,b)=>a.rent-b.rent)[0];if(cheaper)assignUnit(h,cheaper)}}",
  "    for(const h of v011ReviewHouseholds){const current=unitOf(h);if(current?.type==='social'&&h.housingPreference==='private'){const u=v011ReviewPrivateVacant.find(x=>x.occupantId===null&&x.rent<h.income*.36);if(u)assignUnit(h,u)}else if(current?.type==='private'&&current.rent>h.income*.40){const cheaper=v011ReviewPrivateVacant.find(x=>x.occupantId===null&&x.rent<current.rent*.88);if(cheaper)assignUnit(h,cheaper)}}"
);
replaceLine(
  'annual owner review uses vacancy pool',
  "const current=unitOf(h);if(h.housingPreference!=='owner'||current?.type==='owner'||h.income<=0||h.job===null)continue;const u=housingUnits.filter(x=>x.type==='owner'&&x.occupantId===null).sort((a,b)=>a.price-b.price)[0];if(!u)continue;",
  "      const current=unitOf(h);if(h.housingPreference!=='owner'||current?.type==='owner'||h.income<=0||h.job===null)continue;const u=v011ReviewOwnerVacant.find(x=>x.occupantId===null);if(!u)continue;"
);
replaceLine(
  'annual owner review household pool',
  'for(const h of households.filter(annualReview)){',
  '    for(const h of v011ReviewHouseholds){'
);

// ---------------------------------------------------------------------------
// Banking recovery: shared minimum, staged stability entry even while a bridge
// bank exists, realistic private re-entry, and a finite bridge-bank lifetime.
// ---------------------------------------------------------------------------
replaceOnce(
  'private bank entry cooldown applies only to genuine failures',
  "const banksNow=activeBanks(),recentResolution=bankResolutionLedger.some(x=>monthIndex-(x.monthIndex??-999)<36&&!['voluntary merger','bridge sale'].includes(x.route));if(recentResolution)return 0;",
  "const banksNow=activeBanks(),recentFailure=bankResolutionLedger.some(x=>monthIndex-(x.monthIndex??-999)<12&&(String(x.route||'').includes('bridge resolution')||x.route==='closure'||x.route==='bailout'));if(recentFailure)return 0;"
);
replaceOnce(
  'private bank entry hazard under concentration',
  "-recentFailurePenalty-minimumScalePenalty,0,.018)",
  "-recentFailurePenalty*.35-minimumScalePenalty+Math.max(0,minimumBankCount()-banksNow.length)*.012,0,.06)"
);
replaceAllChecked(
  'shared minimum bank rule',
  'minimumBanks=households.length>=250?4:households.length>=100?3:households.length>=25?2:1',
  'minimumBanks=minimumBankCount()',
  1
);
replaceOnce(
  'stability bank cadence state',
  "shortageAge=monthIndex-lastFailureMonth,healthyBanks=bankSet.filter",
  "shortageAge=monthIndex-lastFailureMonth,lastStabilityMonth=bankResolutionLedger.reduce((latest,row)=>row.route==='system-stability bank'?Math.max(latest,row.monthIndex??-999):latest,-999),monthsSinceStability=monthIndex-lastStabilityMonth,healthyBanks=bankSet.filter"
);
replaceOnce(
  'bridge banks no longer block stability entry',
  "stabilityNeeded=bankSet.length<minimumBanks&&!bridgeActive&&(urgentShortage||shortageAge>=24)",
  "stabilityNeeded=bankSet.length<minimumBanks&&monthsSinceStability>=6&&(urgentShortage||shortageAge>=12||bridgeActive)"
);
replaceAllChecked(
  'bridge sale needs one acquirer rather than three banks',
  "activeBanks().length>(households.length>=25?2:1)",
  "activeBanks().length>1",
  1
);
replaceOnce(
  'bridge bank forced resolution successor after five years',
  "const acquirer=activeBanks().filter(b=>b.id!==bank.id&&bankEquity(b)>0&&bankCapitalRatio(b)>=targetCapital).sort((a,b)=>bankCapitalRatio(b)-bankCapitalRatio(a))[0];",
  "let acquirer=activeBanks().filter(b=>b.id!==bank.id&&bankEquity(b)>0&&bankCapitalRatio(b)>=targetCapital).sort((a,b)=>bankCapitalRatio(b)-bankCapitalRatio(a))[0];if(!acquirer&&bank.age>=60)acquirer=suitableBankAcquirer(bank.id,'Resolution Successor Bank');"
);

// Public resolution capital is an ownership claim, not a free windfall for
// randomly assigned household shareholders.
replaceAllChecked('bank public-resolution-equity field', 'resolutionProvision:0,age:0', 'resolutionProvision:0,publicResolutionEquity:0,age:0', 1);
replaceAllChecked('public banks start without private shareholders', 'shareholders:households.length?generateShareholderSlots(16):[]', 'shareholders:entrant&&households.length?generateShareholderSlots(16):[]', 1);
replaceLine(
  'private bank valuation excludes public resolution capital',
  'function bankShareValuation(bank)',
  "  function bankShareValuation(bank){const equity=Math.max(0,bankEquity(bank)),privateEquity=Math.max(0,equity-(bank.publicResolutionEquity||0)),rwa=bankRWA(bank),deposits=bankDeposits(bank.id),sustainable=Math.max(12000*nominalScale(),rwa*.22+deposits*.018);return Math.min(privateEquity,sustainable,annualGDPReference()*.08)}"
);
replaceAllChecked(
  'central bank backstop ownership claim',
  "bank.reserves+=backstop;world.centralBankResolutionBackstop=(world.centralBankResolutionBackstop||0)+backstop",
  "bank.reserves+=backstop;bank.publicResolutionEquity=(bank.publicResolutionEquity||0)+backstop;world.centralBankResolutionBackstop=(world.centralBankResolutionBackstop||0)+backstop",
  2
);
replaceOnce(
  'resolution backstop ownership claim',
  "if(centralBankBackstop>0){bank.reserves+=centralBankBackstop;world.centralBankResolutionBackstop=(world.centralBankResolutionBackstop||0)+centralBankBackstop}",
  "if(centralBankBackstop>0){bank.reserves+=centralBankBackstop;bank.publicResolutionEquity=(bank.publicResolutionEquity||0)+centralBankBackstop;world.centralBankResolutionBackstop=(world.centralBankResolutionBackstop||0)+centralBankBackstop}"
);
replaceOnce(
  'stability bank public ownership',
  "entrant.reserves=capital;entrant.resolutionCooldown=60;banks.push(entrant);world.centralBankResolutionBackstop=(world.centralBankResolutionBackstop||0)+capital",
  "entrant.reserves=capital;entrant.publicResolutionEquity=capital;entrant.shareholders=[];entrant.resolutionCooldown=60;banks.push(entrant);world.centralBankResolutionBackstop=(world.centralBankResolutionBackstop||0)+capital"
);
replaceOnce(
  'transfer public resolution equity',
  "successor.centralBankBorrowing+=failed.centralBankBorrowing;",
  "successor.centralBankBorrowing+=failed.centralBankBorrowing;successor.publicResolutionEquity=(successor.publicResolutionEquity||0)+(failed.publicResolutionEquity||0);"
);
replaceAllChecked(
  'clear failed bank public resolution equity',
  "failed.resolutionProvision=0;failed.active=false",
  "failed.resolutionProvision=0;failed.publicResolutionEquity=0;failed.active=false",
  1
);
replaceOnce(
  'voluntary merger transfers public resolution equity',
  "const transferredReserves=voluntary.reserves,transferredBonds=voluntary.bonds,transferredCentralBankBorrowing=voluntary.centralBankBorrowing;",
  "const transferredReserves=voluntary.reserves,transferredBonds=voluntary.bonds,transferredCentralBankBorrowing=voluntary.centralBankBorrowing,transferredPublicResolutionEquity=voluntary.publicResolutionEquity||0;"
);
replaceOnce(
  'voluntary merger public claim accounting',
  "acquirer.centralBankBorrowing+=transferredCentralBankBorrowing;voluntary.reserves=0;voluntary.bonds=0;voluntary.centralBankBorrowing=0;",
  "acquirer.centralBankBorrowing+=transferredCentralBankBorrowing;acquirer.publicResolutionEquity=(acquirer.publicResolutionEquity||0)+transferredPublicResolutionEquity;voluntary.reserves=0;voluntary.bonds=0;voluntary.centralBankBorrowing=0;voluntary.publicResolutionEquity=0;"
);
replaceOnce(
  'public capital recovers before private bank dividends',
  "}const remainingExcess=Math.max(0,bankEquity(bank)-bankRWA(bank)*dividendTarget)",
  "}const publicClaim=Math.max(0,bank.publicResolutionEquity||0);if(publicClaim>0){const publicRecovery=Math.min(publicClaim,Math.max(0,bankEquity(bank)-bankRWA(bank)*dividendTarget)*.30,Math.max(0,bank.reserves-reserveTarget)*.30);if(publicRecovery>0){bank.reserves-=publicRecovery;bank.publicResolutionEquity=Math.max(0,publicClaim-publicRecovery);world.centralBankResolutionRecoveries=(world.centralBankResolutionRecoveries||0)+publicRecovery}}const remainingExcess=Math.max(0,bankEquity(bank)-bankRWA(bank)*dividendTarget)"
);

// ---------------------------------------------------------------------------
// Runtime overrides that are safer to install after the calibrated initial
// reset, plus exact-value wealth indexing and performance instrumentation.
// ---------------------------------------------------------------------------
const runtimePatch = `
  // SIMFLATION_0_11_0_RUNTIME_START
  function v011RefreshLifecycleIndexes(){
    v011EndedHouseholdIds=new Set(householdLifecycleHistory.filter(x=>x.endMonth!==null).map(x=>x.id));
    v011ExitedPersonIds=new Set(personLifecycleHistory.map(x=>x.id));
    v011FormationIds=new Set();v011DuplicateHouseholdFormation=false;
    for(const row of householdLifecycleHistory){if(row.endMonth!==null)continue;if(v011FormationIds.has(row.id))v011DuplicateHouseholdFormation=true;else v011FormationIds.add(row.id)}
  }
  v011RefreshLifecycleIndexes();
  const v011RecordHouseholdFormationLegacy=recordHouseholdFormation;
  recordHouseholdFormation=function(h,type){if(h){if(v011FormationIds.has(h.id))v011DuplicateHouseholdFormation=true;else v011FormationIds.add(h.id)}return v011RecordHouseholdFormationLegacy(h,type)};
  const v011ArchiveHouseholdEndLegacy=archiveHouseholdEnd;
  archiveHouseholdEnd=function(h,...args){if(h)v011EndedHouseholdIds.add(h.id);return v011ArchiveHouseholdEndLegacy(h,...args)};
  const v011ArchivePersonExitLegacy=archivePersonExit;
  archivePersonExit=function(p,...args){if(p)v011ExitedPersonIds.add(p.id);return v011ArchivePersonExitLegacy(p,...args)};

  function v011BuildOwnershipIndex(){
    const map=new Map(households.map(h=>[h.id,{firms:[],banks:[],landlords:[],developer:0}]));
    const distribute=(list,entity,key)=>{if(!list?.length)return;const fraction=1/list.length,counts=new Map();for(const id of list)if(map.has(id))counts.set(id,(counts.get(id)||0)+fraction);for(const [id,share] of counts)map.get(id)[key].push([entity,share])};
    for(const f of firms)distribute(f.shareholders||[],f,'firms');for(const b of activeBanks())distribute(b.shareholders||[],b,'banks');for(const l of landlords)distribute(l.shareholders||[],l,'landlords');
    if(developer?.shareholders?.length){const fraction=1/developer.shareholders.length;for(const id of developer.shareholders)if(map.has(id))map.get(id).developer+=fraction}
    return map
  }
  function v011WealthComponentsFromIndex(h,index,entityValues=null){
    const unit=unitOf(h),home=unit?.type==='owner'?Math.max(0,unit.price-(unit.mortgageBalance||0)):0,own=index.get(h.id)||{firms:[],banks:[],landlords:[],developer:0};let companies=0,banksValue=0,propertyBusiness=0;
    for(const [f,share] of own.firms)companies+=(entityValues?.firms?.get(f.id)??firmValuation(f)*(1-(f.publicOwnership||0)))*share;
    for(const [b,share] of own.banks)banksValue+=(entityValues?.banks?.get(b.id)??bankShareValuation(b))*share;
    for(const [l,share] of own.landlords)propertyBusiness+=(entityValues?.landlords?.get(l.id)??Math.max(0,l.cash+propertyAssetValue(l)-l.debt))*share;
    if(own.developer)propertyBusiness+=(entityValues?.developer??Math.max(0,developer.cash+propertyAssetValue(developer)-developer.debt))*own.developer;
    return{cash:Math.max(0,h.cash),home,companies,banks:banksValue,propertyBusiness}
  }
  function v011BuildWealthBundle(){
    const index=v011BuildOwnershipIndex(),entityValues={firms:new Map(),banks:new Map(),landlords:new Map(),developer:developer?Math.max(0,developer.cash+propertyAssetValue(developer)-developer.debt):0};
    for(const f of firms)entityValues.firms.set(f.id,firmValuation(f)*(1-(f.publicOwnership||0)));for(const b of activeBanks())entityValues.banks.set(b.id,bankShareValuation(b));for(const l of landlords)entityValues.landlords.set(l.id,Math.max(0,l.cash+propertyAssetValue(l)-l.debt));
    const components=new Map(),wealth=new Map(),totals={cash:0,home:0,companies:0,banks:0,propertyBusiness:0};for(const h of households){const c=v011WealthComponentsFromIndex(h,index,entityValues),w=sum(Object.values(c));components.set(h.id,c);wealth.set(h.id,w);for(const [k,v] of Object.entries(c))totals[k]+=v}return{index,components,wealth,totals}
  }
  let v011SnapshotWealthMonth=-1,v011SnapshotWealthBundle=null;
  const v011HouseholdWealthComponentsLegacy=householdWealthComponents,v011HouseholdNetWealthLegacy=householdNetWealth,v011CurrentClassAssignmentsLegacy=currentClassAssignments;
  householdWealthComponents=function(h){const c=v011SnapshotWealthMonth===monthIndex?v011SnapshotWealthBundle?.components.get(h.id):null;return c?{...c}:v011HouseholdWealthComponentsLegacy(h)};
  householdNetWealth=function(h){const w=v011SnapshotWealthMonth===monthIndex?v011SnapshotWealthBundle?.wealth.get(h.id):undefined;return Number.isFinite(w)?w:v011HouseholdNetWealthLegacy(h)};
  currentClassAssignments=function(){
    if(v011SnapshotWealthMonth!==monthIndex||!v011SnapshotWealthBundle)return v011CurrentClassAssignmentsLegacy();
    if(classAssignmentCacheMonth===monthIndex&&classAssignmentCache&&Object.keys(classAssignmentCache).length===households.length)return classAssignmentCache;
    const wealth=households.map(h=>v011SnapshotWealthBundle.wealth.get(h.id)||0),realIncome=households.map(h=>Math.max(0,h.income)/Math.max(.2,nominalScale())),wealthMedian=Math.max(1,median(wealth)),incomeMedian=Math.max(1,median(realIncome.filter(x=>x>0))),wealthSorted=[...wealth].sort((a,b)=>a-b),p90=wealthSorted[Math.max(0,Math.floor(wealthSorted.length*.90)-1)]||wealthMedian*4,out={};
    households.forEach((h,i)=>{const w=wealth[i],inc=realIncome[i],unit=unitOf(h),secure=!!unit&&(unit.type!=='private'||h.housingCost<Math.max(1,h.income)*.42),employed=h.job!==null,qualified=['degree','advanced','technical'].includes(h.educationLevel);if(w>=Math.max(p90,wealthMedian*4))out[h.id]='wealthy';else if(employed&&qualified&&(inc>incomeMedian*1.20||w>wealthMedian*1.35))out[h.id]='professional';else if((secure||w>wealthMedian*1.15)&&(employed||w>wealthMedian*.95)&&inc>incomeMedian*.65)out[h.id]='middle';else out[h.id]='working'});classAssignmentCacheMonth=monthIndex;classAssignmentCache=out;return out
  };
  wealthStatistics=function(){
    const bundle=v011BuildWealthBundle();v011SnapshotWealthMonth=monthIndex;v011SnapshotWealthBundle=bundle;invalidateClassAssignments();const wealth=households.map(h=>bundle.wealth.get(h.id)||0);latestHouseholdWealthCheck=wealth.slice();const sorted=[...wealth].sort((a,b)=>b-a),topN=Math.max(1,Math.ceil(sorted.length*.10)),total=sum(sorted),incomes=households.map(h=>Math.max(0,h.income)).sort((a,b)=>a-b),quint=Math.max(1,Math.floor(incomes.length*.2)),bottom=avg(incomes.slice(0,quint)),top=avg(incomes.slice(-quint)),classes=currentClassAssignments(),classCounts=Object.fromEntries(Object.keys(classLabels).map(k=>[k,Object.values(classes).filter(v=>v===k).length));return{gini:gini(wealth),topShare:total?sum(sorted.slice(0,topN))/total*100:0,median:median(wealth),incomeRatio:bottom>0?top/bottom:(top>0?Infinity:null),inheritance:sum(households.map(h=>h.inheritanceReceived||0)),classCounts,components:{...bundle.totals},totalWealth:total}
  };
  applyWealthCirculation=function(){
    const perHouseGDP=annualGDPReference()/Math.max(1,households.length),monthlyAnchor=perHouseGDP/12,serviceFirms=sectorFirms('services');if(!serviceFirms.length)return;const ownership=v011BuildOwnershipIndex();
    for(const h of households){const wealth=sum(Object.values(v011WealthComponentsFromIndex(h,ownership))),threshold=Math.max(25000*nominalScale(),perHouseGDP*6);if(wealth<=threshold||h.cash<=0)continue;const excess=Math.max(0,wealth-threshold),sustainableDraw=Math.min(excess*.0015,Math.max(monthlyAnchor*.20,(h.income||0)*.35)),spend=Math.min(h.cash,sustainableDraw),seller=weighted(serviceFirms,f=>Math.max(1,f.workers.length+f.vacancies));if(spend>0&&seller){domesticTransfer(h,seller,spend);seller.revenue+=spend;seller.sales+=spend/Math.max(1,seller.price);h.totalSpending+=spend}}
  };

  const v011SuitableBankAcquirerLegacy=suitableBankAcquirer;
  suitableBankAcquirer=function(excludeId,name='Successor Bank'){
    let acquirer=activeBanks().filter(b=>b.id!==excludeId&&bankEquity(b)>0).sort((a,b)=>bankCapitalRatio(b)-bankCapitalRatio(a))[0];
    if(!acquirer){acquirer=createBank(name,true);banks.push(acquirer);entries++;const raised=capitaliseNewBank(acquirer);if(raised<=0){const capital=Math.max(500000*nominalScale(),annualGDPReference()*.01);acquirer.active=true;acquirer.failedEntry=false;acquirer.name='Public '+name;acquirer.reserves=capital;acquirer.publicResolutionEquity=capital;acquirer.shareholders=[];world.centralBankResolutionBackstop=(world.centralBankResolutionBackstop||0)+capital;recordBankResolution({bankId:acquirer.id,bankName:acquirer.name,route:'public resolution successor',openingEquity:0,centralBankBackstop:capital,targetCapitalRatio:Math.max(.20,Number($('capitalRequirement').value)/100+.10)})}}
    return acquirer
  };

  const v011ResetLegacy=reset;
  reset=function(...args){const out=v011ResetLegacy(...args);v011RefreshLifecycleIndexes();v011MigrationStatsMonth=-1;v011MigrationStats=null;v011SnapshotWealthMonth=-1;v011SnapshotWealthBundle=null;return out};
  const v011EnforceMonthlyInvariantsLegacy=enforceMonthlyInvariants;
  enforceMonthlyInvariants=function(s){const result=v011EnforceMonthlyInvariantsLegacy(s);if(modelCheckHistory.length>120&&!result.length)modelCheckHistory=modelCheckHistory.slice(-120);return result};

  const v011PhaseStats={};
  function v011Timed(name,fn){return function(...args){const started=performance.now();try{return fn.apply(this,args)}finally{const ms=performance.now()-started,row=v011PhaseStats[name]||(v011PhaseStats[name]={calls:0,totalMs:0,lastMs:0,maxMs:0});row.calls++;row.totalMs+=ms;row.lastMs=ms;row.maxMs=Math.max(row.maxMs,ms)}}}
  finalDemand=v011Timed('demand',finalDemand);housingSearchAndPrices=v011Timed('housing',housingSearchAndPrices);updateBanks=v011Timed('banking',updateBanks);snapshot=v011Timed('snapshot',snapshot);updatePoliticalMonth=v011Timed('politics',updatePoliticalMonth);enforceMonthlyInvariants=v011Timed('integrity',enforceMonthlyInvariants);

  async function v011RunLongAudit(months=1200,seed=42){
    const settings=collectPolicySettings(),startingSeed=Number($('seed').value)||42,wasSuppress=suppressRendering;running=false;clearInterval(timer);suppressRendering=true;$('seed').value=String(seed);reset();let oneBankMonths=0,belowMinimumMonths=0,maxConsecutiveOneBank=0,currentOneBank=0,maxBridgeAge=0,minBanks=Infinity;
    try{for(let m=0;m<months&&!modelHalted;m++){if(politics?.pendingElection&&!resolvePendingElectionForAutomation())break;stepSimulation();if(politics?.pendingElection&&!resolvePendingElectionForAutomation())break;const live=activeBanks(),count=live.length;minBanks=Math.min(minBanks,count);if(count===1&&minimumBankCount()>1){oneBankMonths++;currentOneBank++;maxConsecutiveOneBank=Math.max(maxConsecutiveOneBank,currentOneBank)}else currentOneBank=0;if(count<minimumBankCount())belowMinimumMonths++;for(const b of live)if(b.name.startsWith('Bridge Bank'))maxBridgeAge=Math.max(maxBridgeAge,b.age||0)}const successfulPrivate=[...banks,...bankArchive].filter(b=>String(b.name||'').startsWith('New Bank')&&!b.failedEntry),publicClaim=sum(activeBanks().map(b=>Math.max(0,b.publicResolutionEquity||0)));return{monthsRequested:months,monthsCompleted:monthIndex,halted:modelHalted,problems:collectRunChecks(),minBanks:Number.isFinite(minBanks)?minBanks:0,oneBankMonths,belowMinimumMonths,maxConsecutiveOneBank,maxBridgeAge,successfulPrivateEntrants:new Set(successfulPrivate.map(b=>b.id)).size,failures,entries,exits,centralBankBackstop:world.centralBankResolutionBackstop||0,centralBankRecoveries:world.centralBankResolutionRecoveries||0,outstandingPublicResolutionEquity:publicClaim,performance:typeof v66PerformanceSummary==='function'?v66PerformanceSummary():null,phasePerformance:JSON.parse(JSON.stringify(v011PhaseStats))}}
    finally{suppressRendering=wasSuppress;applyPolicySettings(settings);$('seed').value=String(startingSeed);reset();running=false;if(!suppressRendering&&history.at(-1))draw(history.at(-1));restartTimer()}
  }
  if(window.__sim){window.__sim.runLongAudit=v011RunLongAudit;window.__sim.performancePhases=()=>JSON.parse(JSON.stringify(v011PhaseStats));window.__sim.minimumBankCount=minimumBankCount}
  // SIMFLATION_0_11_0_RUNTIME_END
`;
replaceOnce(
  'install 0.11.0 runtime patch before outer model closure',
  "/* SIMFLATION_V60_POLITICS_END */\n\n})();",
  `/* SIMFLATION_V60_POLITICS_END */\n\n${runtimePatch}\n})();`
);

// Release identity. Semantic versions are now the public and model identity.
replaceOnce(
  'current release pointer',
  "  window.__simflationV67={...window.__simflationV66,version:'0.10.0',releaseVersion:'0.10.0',modelVersion:'v67'};\n  window.__simflationCurrent=window.__simflationV67;",
  "  window.__simflationV67={...window.__simflationV66,version:'0.10.0',releaseVersion:'0.10.0',modelVersion:'v67'};\n  window.__simflation0110={...window.__simflationV67,version:'0.11.0',releaseVersion:'0.11.0',modelVersion:'0.11.0'};\n  window.__simflationCurrent=window.__simflation0110;"
);
replaceAllChecked('HTML title release identity', '<title>SimFlation 0.10.0</title>', '<title>SimFlation 0.11.0</title>', 1);
replaceAllChecked('edition badge release identity', 'edition-badge">0.10.0<', 'edition-badge">0.11.0<', 1);
html = html.split("current.releaseVersion || '0.10.0'").join("current.releaseVersion || '0.11.0'");
html = html.replace('/* SimFlation v67 banking stability build, based on the v66 interface/performance release. */', '/* SimFlation 0.11.0 banking recovery and long-run performance release. */\n/* SimFlation v67 banking stability build, based on the v66 interface/performance release. */');

// Parse every inline script before GitHub publishes the generated build.
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
for (let i = 0; i < scripts.length; i++) new vm.Script(scripts[i], {filename:`SimFlation-0.11.0-inline-${i + 1}.js`});

const version = {
  version: '0.11.0',
  label: '0.11.0',
  modelVersion: '0.11.0',
  standalone: 'SimFlation-0.11.0.html',
  modelStandalone: 'SimFlation-0.11.0.html'
};

fs.writeFileSync(outputPath, html);
fs.writeFileSync('index.html', html);
fs.writeFileSync('version.json', JSON.stringify(version, null, 2) + '\n');

console.log(`Built ${outputPath}; ${scripts.length} inline scripts parsed successfully. Replaced ${householdIncludesReplaced} household and ${firmIncludesReplaced} firm linear membership checks.`);

import fs from 'node:fs';
import vm from 'node:vm';

for (const path of ['SimFlation-0.11.1.html','index.html']) {
  let html=fs.readFileSync(path,'utf8');
  function replaceOnce(label,before,after){const i=html.indexOf(before);if(i<0)throw new Error(`Missing accounting patch target ${label} in ${path}`);if(html.indexOf(before,i+before.length)>=0)throw new Error(`Non-unique accounting patch target ${label} in ${path}`);html=html.slice(0,i)+after+html.slice(i+before.length)}

  replaceOnce('government bank settlement',
`  function governmentPaysBank(bank,requested,category){
    ensureGovernmentCash(requested);const amount=Math.min(requested,government.cash);government.cash-=amount;const gb=bankById(government.bankId);if(gb&&gb.id!==bank.id){if(gb.reserves<amount){gb.centralBankBorrowing+=amount-gb.reserves;gb.reserves=amount}gb.reserves-=amount;bank.reserves+=amount}
    government[category]+=amount;
    if(category==='bankSupportSpending'){government.cumulativeBankSupport+=amount;government.bankInvestments[bank.id]=(government.bankInvestments[bank.id]||0)+amount}
    return amount
  }`,
`  function governmentPaysBank(bank,requested,category){
    ensureGovernmentCash(requested);let amount=Math.min(requested,government.cash);const gb=bankById(government.bankId);if(gb&&gb.id!==bank.id)amount=settleBankPayment(gb,bank,amount);if(amount<=0)return 0;government.cash-=amount;government[category]+=amount;
    if(category==='bankSupportSpending'){government.cumulativeBankSupport+=amount;government.bankInvestments[bank.id]=(government.bankInvestments[bank.id]||0)+amount}
    return amount
  }`);

  replaceOnce('investment tax actual receipts',
"    domesticTransfer(payer,household,net);domesticTransfer(payer,government,tax);recordTax(tax,'investmentTaxRevenue');household.income+=net;household.capitalIncome=(household.capitalIncome||0)+net;household.lifetimeCapitalIncome=(household.lifetimeCapitalIncome||0)+net;return gross",
"    const netPaid=domesticTransfer(payer,household,net),taxPaid=domesticTransfer(payer,government,tax);recordTax(taxPaid,'investmentTaxRevenue');household.income+=netPaid;household.capitalIncome=(household.capitalIncome||0)+netPaid;household.lifetimeCapitalIncome=(household.lifetimeCapitalIncome||0)+netPaid;return netPaid+taxPaid");

  replaceOnce('payroll actual receipts and wages',
"const gross=item.gross*ratio,tax=incomeTaxDue(gross),payrollTax=gross*payrollRate;domesticTransfer(f,h,gross-tax);domesticTransfer(f,government,tax);recordTax(tax,'incomeTaxRevenue');domesticTransfer(f,government,payrollTax);recordTax(payrollTax,'payrollTaxRevenue');p.labourIncome=(p.labourIncome||0)+gross-tax;p.lifetimeLabourIncome=(p.lifetimeLabourIncome||0)+gross-tax;h.labourIncome=(h.labourIncome||0)+gross-tax;h.lifetimeLabourIncome=(h.lifetimeLabourIncome||0)+gross-tax;h.income+=gross-tax;f.wageCost+=gross+payrollTax",
"const gross=item.gross*ratio,tax=incomeTaxDue(gross),payrollTax=gross*payrollRate,netPaid=domesticTransfer(f,h,gross-tax),taxPaid=domesticTransfer(f,government,tax),payrollPaid=domesticTransfer(f,government,payrollTax);recordTax(taxPaid,'incomeTaxRevenue');recordTax(payrollPaid,'payrollTaxRevenue');p.labourIncome=(p.labourIncome||0)+netPaid;p.lifetimeLabourIncome=(p.lifetimeLabourIncome||0)+netPaid;h.labourIncome=(h.labourIncome||0)+netPaid;h.lifetimeLabourIncome=(h.lifetimeLabourIncome||0)+netPaid;h.income+=netPaid;f.wageCost+=netPaid+taxPaid+payrollPaid");

  replaceOnce('business tax actual receipts',
"const tax=Math.min(f.profit*businessTax,f.cash);domesticTransfer(f,government,tax);recordTax(tax,'businessTaxRevenue');f.profit-=tax;f.lossMonths=0;const publicDividend=Math.min(f.profit*(f.publicOwnership||0)*.35,Math.max(0,f.cash-f.wage*5));if(publicDividend>0){domesticTransfer(f,government,publicDividend);government.publicEnterpriseRevenue+=publicDividend;f.profit-=publicDividend}",
"const tax=Math.min(f.profit*businessTax,f.cash),taxPaid=domesticTransfer(f,government,tax);recordTax(taxPaid,'businessTaxRevenue');f.profit-=taxPaid;f.lossMonths=0;const publicDividend=Math.min(f.profit*(f.publicOwnership||0)*.35,Math.max(0,f.cash-f.wage*5));if(publicDividend>0){const dividendPaid=domesticTransfer(f,government,publicDividend);government.publicEnterpriseRevenue+=dividendPaid;f.profit-=dividendPaid}");

  replaceOnce('inheritance tax actual receipts',
"const tax=Math.min(Math.max(0,household.cash),taxDue);if(tax>0){domesticTransfer(household,government,tax);recordTax(tax,'inheritanceTaxRevenue')}const remainingOwnership=ownershipValueForHousehold(removedId)",
"let tax=Math.min(Math.max(0,household.cash),taxDue);if(tax>0){tax=domesticTransfer(household,government,tax);recordTax(tax,'inheritanceTaxRevenue')}const remainingOwnership=ownershipValueForHousehold(removedId)");

  replaceOnce('bank switching settlement',
"  function switchBank(entity,newId){if(entity.bankId===newId)return;const oldId=entity.bankId,old=bankById(oldId),next=bankById(newId),cash=Math.max(0,entity.cash||0);if(old)old.reserves-=cash;if(next)next.reserves+=cash;if(bankBalanceCache){v011AdjustDepositCache(oldId,-cash);v011AdjustDepositCache(newId,cash)}entity.bankId=newId}",
"  function switchBank(entity,newId){if(entity.bankId===newId)return false;const oldId=entity.bankId,old=bankById(oldId),next=bankById(newId),cash=Math.max(0,entity.cash||0);if(old&&next&&old.id!==next.id&&cash>0){const settled=settleBankPayment(old,next,cash);if(settled+1e-6<cash){if(settled>0)settleBankPayment(next,old,settled);return false}}if(bankBalanceCache){v011AdjustDepositCache(oldId,-cash);v011AdjustDepositCache(newId,cash)}entity.bankId=newId;return true}");

  // Capture resolution routes before runLongAudit resets the model, so policy tests are real.
  replaceOnce('long audit forensic return',
"successfulPrivateEntrants:new Set(successfulPrivate.map(b=>b.id)).size,failures,entries,exits,centralBankBackstop:world.centralBankResolutionBackstop||0,centralBankRecoveries:world.centralBankResolutionRecoveries||0,outstandingPublicResolutionEquity:publicClaim,performance:",
"successfulPrivateEntrants:new Set(successfulPrivate.map(b=>b.id)).size,failures,entries,exits,bankPolicy:$('bankPolicy').value,resolutionRoutes:bankResolutionLedger.slice(),firstMonetaryInvariant:world.firstMonetaryInvariant||null,centralBankBackstop:world.centralBankResolutionBackstop||0,centralBankRecoveries:world.centralBankResolutionRecoveries||0,outstandingPublicResolutionEquity:publicClaim,performance:");

  const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m=>m[1]);for(let i=0;i<scripts.length;i++)new vm.Script(scripts[i],{filename:`${path}-accounting-${i+1}.js`});
  fs.writeFileSync(path,html);
}
console.log('Applied settlement-aware accounting and audit forensics to SimFlation 0.11.1.');

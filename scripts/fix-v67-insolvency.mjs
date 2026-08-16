import fs from 'node:fs';

const path = 'scripts/build-v67.mjs';
let text = fs.readFileSync(path, 'utf8');
const needle = "lastBankResolutionText=bank.name+' entered a capital recovery plan'";
const matches = text.split(needle).length - 1;
if (matches !== 2) throw new Error(`Expected two v67 capital-recovery paths, found ${matches}`);
const replacement = `{if(bank.emergencyBackstopUsed)resolveBank(bank);else{const backstop=Math.max(0,bankRWA(bank)*requirement-bankEquity(bank));if(backstop>0){bank.reserves+=backstop;world.centralBankResolutionBackstop=(world.centralBankResolutionBackstop||0)+backstop}bank.distressMonths=0;bank.underCapitalMonths=0;bank.resolutionCooldown=12;bank.emergencyBackstopUsed=true;recordBankResolution({bankName:bank.name,route:'one-off central-bank solvency recapitalisation',openingEquity:equity,centralBankBackstop:backstop,finalEquity:bankEquity(bank),finalCapitalRatio:bankCapitalRatio(bank)});lastBankResolutionText=bank.name+' received a one-off solvency recapitalisation of '+money(backstop)}}`;
text = text.split(needle).join(replacement);
fs.writeFileSync(path, text);
console.log('Replaced both unresolved negative-equity recovery paths with one-off solvency recapitalisation.');

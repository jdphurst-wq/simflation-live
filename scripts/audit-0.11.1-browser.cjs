const { chromium } = require('playwright-core');

async function load(page,path){await page.goto(`http://127.0.0.1:8000/${path}`,{waitUntil:'load',timeout:60000});await page.waitForFunction(()=>!!window.__sim?.runLongAudit,null,{timeout:60000})}
async function set(page,id,value){await page.evaluate(({id,value})=>{const el=document.getElementById(id);if(!el)throw new Error(`Missing control ${id}`);el.value=String(value);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))},{id,value})}
async function configure(page,seed=42,policy='resolve'){await set(page,'capitalRequirement',10);await set(page,'bankPolicy',policy);await set(page,'seed',seed)}

(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e&&e.stack||e)));
 await load(page,'SimFlation-0.11.1.html');
 const release=await page.evaluate(()=>({title:document.title,badge:document.querySelector('.edition-badge')?.textContent?.trim(),current:window.__simflationCurrent?{version:window.__simflationCurrent.version,releaseVersion:window.__simflationCurrent.releaseVersion,modelVersion:window.__simflationCurrent.modelVersion}:null}));
 const runs=[];for(const seed of [42,7,99]){await configure(page,seed,'resolve');const result=await page.evaluate(seed=>window.__sim.runLongAudit(1800,seed),seed);runs.push({seed,...result})}
 await configure(page,42,'noSupport');const noSupport=await page.evaluate(()=>window.__sim.runLongAudit(1200,42));
 const forbidden=(noSupport.resolutionRoutes||[]).filter(x=>{const route=String(x.route||'').toLowerCase();return route.includes('central-bank recapitalisation')||route.includes('central-bank solvency')||route.includes('bridge stabilisation')||route.includes('system-stability bank')||route==='bailout'});
 await browser.close();
 const result={release,runs,noSupport,forbiddenNoSupportRoutes:forbidden,errors};console.log('SIMFLATION_0_11_1_AUDIT='+JSON.stringify(result));
 if(errors.length)throw new Error(`Browser errors: ${JSON.stringify(errors)}`);
 if(release.title!=='SimFlation 0.11.1'||release.badge!=='0.11.1'||release.current?.version!=='0.11.1'||release.current?.modelVersion!=='0.11.1')throw new Error(`Release identity mismatch: ${JSON.stringify(release)}`);
 for(const run of runs){if(run.halted||run.problems.length)throw new Error(`Seed ${run.seed} failed 150-year audit: ${JSON.stringify(run.problems)}`);if(run.maxBridgeAge>60)throw new Error(`Seed ${run.seed} bridge age ${run.maxBridgeAge}`);if(run.maxConsecutiveOneBank>24)throw new Error(`Seed ${run.seed} one-bank run ${run.maxConsecutiveOneBank}`);if(run.firstMonetaryInvariant)throw new Error(`Seed ${run.seed} monetary guard fired: ${JSON.stringify(run.firstMonetaryInvariant)}`)}
 if(noSupport.bankPolicy!=='noSupport')throw new Error(`No-support audit ran with wrong policy: ${noSupport.bankPolicy}`);
 if(noSupport.halted||noSupport.problems.length)throw new Error(`No-support audit failed: ${JSON.stringify(noSupport.problems)}`);
 if(noSupport.firstMonetaryInvariant)throw new Error(`No-support monetary guard fired: ${JSON.stringify(noSupport.firstMonetaryInvariant)}`);
 if(forbidden.length)throw new Error(`No-support produced forbidden public solvency support: ${JSON.stringify(forbidden.slice(0,5))}`);
})().catch(e=>{console.error(e&&e.stack||e);process.exit(1)});

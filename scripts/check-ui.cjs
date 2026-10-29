const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.UI_BASE_URL || 'http://localhost:4173/ai-note/';
const out = path.resolve('.expo/ui-check');
fs.mkdirSync(out, { recursive: true });
const settings = {mode:'demo',memberId:'mom',deviceName:'UI test',github:{owner:'',repo:'',token:''},firebase:{familyId:''}};
const now = new Date().toISOString();
const date = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const period = date.slice(0,7);
const doc = (id,data) => ({...data,id,version:1,createdAt:now,updatedAt:now,updatedBy:'mom',schemaVersion:1});
const title = '가독성 확인용 긴 이름의 수학 심화 학원';
const seed = {
 academies:[doc('a1',{name:title,subject:'수학',status:'active'})],
 events:[doc('e1',{kind:'class',title,targets:['son'],date,start:'15:00',end:'16:00',scope:'family',checklist:['교재','필기구']}),doc('e2',{kind:'family',title:'가족 일정',targets:['daughter'],date,start:'15:30',end:'16:30',scope:'family'})],
 bills:[doc('b1',{title,academyId:'a1',childId:'son',period,amount:1234567,dueDate:date,payer:'dad',source:'manual'}),doc('b2',{title:'영어 학원',academyId:'a1',childId:'daughter',period,amount:360000,dueDate:date,payer:'mom',source:'manual'})],
};
let browser, page;
(async()=>{
 browser=await chromium.launch({channel:'msedge',headless:true,timeout:20000});
 const context=await browser.newContext({timezoneId:'Asia/Seoul',reducedMotion:'reduce'});
 await context.addInitScript(({settings,seed})=>{if(!localStorage.getItem('ui-check-seeded')){localStorage.setItem('ai-note.device-settings.v1',JSON.stringify(settings));localStorage.setItem('ai-note.demo-data.v1',JSON.stringify(seed));localStorage.setItem('ui-check-seeded','1');}}, {settings,seed});
 page=await context.newPage(); page.setDefaultTimeout(15000); let screens=0; const errors=[];page.on('pageerror',e=>errors.push(e.message));
 async function check(route,width,height=900,tag=''){
  await page.setViewportSize({width,height});
  await page.goto(base+route,{waitUntil:'networkidle'});
  await page.getByText(route==='input'?'메시지':route==='cost'?'학원비':title,{exact:false}).first().waitFor({timeout:15000});
  const overflow=await page.evaluate(()=>Array.from(document.querySelectorAll('#root *')).filter(el=>{
   const s=getComputedStyle(el),r=el.getBoundingClientRect();
   return s.display!=='none' && r.width>0 && r.height>0 && r.left>=0 && r.right>innerWidth+2 && !el.closest('[aria-hidden="true"]');
  }).slice(0,5).map(el=>({text:el.textContent.slice(0,45),right:Math.round(el.getBoundingClientRect().right),role:el.getAttribute('role')})));
  assert.deepEqual(overflow,[],`${route} ${width} horizontal overflow: ${JSON.stringify(overflow)}`);
  await page.screenshot({path:path.join(out,`${route||'home'}-${width}${tag}.png`)});
  screens++; console.log(`PASS ${route||'home'} ${width}x${height}`);
 }
 if (!process.env.UI_INTERACTIONS_ONLY) {
 for(const width of [375,390,768,1024,1280,1440]) for(const route of ['', 'schedule','cost','input']) await check(route,width);
 for(const route of ['', 'schedule','cost','input']) await check(route,844,390,'-landscape');
 // 200% browser zoom has half the CSS viewport available for reflow.
 for(const route of ['', 'schedule','cost','input']) await check(route,720,450,'-zoom200');
 }
 await check('cost',1440);
 await page.getByRole('button',{name:`${title} 청구 상세 보기`,exact:true}).click();
 await page.getByRole('button',{name:'상세 닫기',exact:true}).waitFor();
 await page.getByRole('button',{name:'상세 닫기',exact:true}).click();
 await page.setViewportSize({width:390,height:844}); await page.goto(base+'cost',{waitUntil:'networkidle'});
 await page.getByRole('button',{name:'납부 기록',exact:true}).first().click();
 const save=page.getByRole('button',{name:'납부 기록 저장',exact:true});
 await save.waitFor();
 const dateField=page.getByLabel('납부일',{exact:true});
 await dateField.fill('2026-99-99'); await dateField.press('Tab');
 assert.equal(await save.isDisabled(),true,'invalid date must block saving');
 await dateField.fill(date); await dateField.press('Tab');
 assert.equal(await save.isEnabled(),true);
 await save.focus(); await page.keyboard.press('Tab');
 const inside=await page.evaluate(()=>!!document.activeElement.closest('[role="dialog"]'));
 assert.equal(inside,true,'Tab stays in payment dialog');
 await page.screenshot({path:path.join(out,'payment-mobile.png')});
 await page.keyboard.press('Escape'); await save.waitFor({state:'hidden'});
 await page.getByRole('button',{name:'납부 기록',exact:true}).first().click();
 await page.getByRole('button',{name:'납부 기록 저장',exact:true}).click();
 await page.getByRole('button',{name:'납부 기록 저장',exact:true}).waitFor({state:'hidden'});
 const payments=await page.evaluate(()=>JSON.parse(localStorage.getItem('ai-note.demo-data.v1')).payments);
 assert.equal(payments.length,1,'exactly one payment recorded');
 assert.deepEqual(errors,[],'no runtime errors');
 console.log('PASS panel, invalid date, keyboard trap, Escape and payment save');
 await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('ai-note.device-settings.v1'));s.memberId='son';localStorage.setItem('ai-note.device-settings.v1',JSON.stringify(s));});
 await page.goto(base+'cost',{waitUntil:'networkidle'}); await page.getByText('비용 정보는 부모만 볼 수 있습니다.').waitFor();
 await page.goto(base+'input',{waitUntil:'networkidle'}); await page.getByText('부모만 사용할 수 있습니다.').waitFor();
 console.log('PASS child permissions');
 fs.writeFileSync(path.join(out,process.env.UI_INTERACTIONS_ONLY ? 'interaction-result.json' : 'result.json'),JSON.stringify({screens,interactions:'passed',errors},null,2));
 await browser.close();
})().catch(async e=>{console.error(e);await page?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});process.exitCode=1;}).finally(async()=>{await browser?.close();});

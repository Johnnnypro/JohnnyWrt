// Run against the real views in prepare-ui-preview.py output; requires Playwright.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');

(async()=>{
    const browser=await chromium.launch({headless:true,
        ...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
    try {
        const page=await browser.newPage();
        await page.goto(process.argv[2]||'http://127.0.0.1:8765/index.html');
        await page.locator('#app[data-page="home"]').waitFor();
        let checked=0;
        for(const width of [1280,900,390,320])for(const dark of [false,true])for(const name of ['香港专线','香港高速专线 · 备用订阅 · '+ 'VeryLongSubscription'.repeat(6)]){
            await page.setViewportSize({width,height:1000});
            await page.evaluate(({dark,name})=>{
                document.documentElement.dataset.darkmode=String(dark);
                currentView.subscriptionSnapshot={current:'subscription:demo',subscriptions:[{'.name':'demo',name}]};
                currentView.account={logged_in:true,username:'Johnny'};
                currentView.draw();
            },{dark,name});
            const result=await page.locator('.jw-subscription').evaluate(el=>{
                const select=el.querySelector('select'),button=el.querySelector('.jw-refresh');
                const rect=e=>({x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height});
                return {select:rect(select),button:rect(button),icon:rect(button.querySelector('svg')),
                    title:select.title,name:select.selectedOptions[0].textContent,label:button.textContent,
                    font:parseFloat(getComputedStyle(select).fontSize),overflow:document.documentElement.scrollWidth>innerWidth};
            });
            assert.match(result.label,/更新订阅/,'The smaller action must retain a visible label');
            assert(result.button.height<=34&&result.icon.width<=16,'Compact update button');
            assert.equal(result.title,name,'Full current name stays available when truncated');
            assert.equal(result.name,name,'Native option retains the complete name');
            assert(result.font>=14&&result.font<=16,'Normal-sized subscription name');
            assert(!result.overflow,`No horizontal page overflow: ${width}, ${name}`);
            if(width>=900){
                assert(result.select.width>=140,'Ordinary names have breathing room');
                assert(Math.abs(result.select.y-result.button.y)<4,'Desktop controls share one row');
            }
            checked++;
        }
        for(const account of [null,{logged_in:false},{logged_in:true,username:'Account'.repeat(30)}]){
            await page.setViewportSize({width:320,height:1000});
            await page.evaluate(account=>{currentView.account=account;currentView.draw();},account);
            assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Account errors and long names must not overflow mobile');
            checked++;
        }
        console.log(`PASS: ${checked} subscription layouts (short/long, light/dark, desktop/mobile, account states)`);
    } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

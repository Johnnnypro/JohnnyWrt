// Run against prepare-ui-preview.py output served locally; requires Playwright.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');

(async()=>{
    const browser=await chromium.launch({headless:true,
        ...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
    try {
        const page=await browser.newPage();
        await page.emulateMedia({reducedMotion:'reduce'});
        await page.goto(process.argv[2]||'http://127.0.0.1:8765/index.html');
        await page.locator('#app[data-page="home"]').waitFor();
        const cdp=await page.context().newCDPSession(page);
        let checked=0;
        for(const width of [1280,390])for(const dark of [false,true])for(const zoom of [1,1.75]){
            await page.setViewportSize({width,height:900});
            await page.evaluate(({dark,zoom})=>{
                document.documentElement.dataset.darkmode=String(dark);
                document.querySelector('#app').style.zoom=zoom;
            },{dark,zoom});
            for(const on of [false,true])for(const disabled of [false,true]){
                await page.locator('.jw-toggle').evaluate((e,{on,disabled})=>{
                    e.classList.toggle('jw-toggle-on',on);
                    e.setAttribute('aria-checked',String(on));e.disabled=disabled;
                },{on,disabled});
                const {root}=await cdp.send('DOM.getDocument');
                const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector:'.jw-toggle'});
                const {node}=await cdp.send('DOM.describeNode',{nodeId});
                const before=node.pseudoElements.find(p=>p.pseudoType==='before');
                const track=(await cdp.send('DOM.getBoxModel',{nodeId})).model.content;
                const knob=(await cdp.send('DOM.getBoxModel',{backendNodeId:before.backendNodeId})).model.border;
                const label=JSON.stringify({width,dark,zoom,on,disabled});
                assert(knob[0]>=track[0]-.25&&knob[2]<=track[2]+.25&&
                    knob[1]>=track[1]-.25&&knob[5]<=track[5]+.25,
                    `Thumb must stay inside the padded track: ${label}`);
                assert(Math.abs(on?knob[2]-track[2]:knob[0]-track[0])<.25,
                    `Thumb must reach the selected end of the track: ${label}`);
                checked++;
            }
        }
        console.log(`PASS: ${checked} switch layouts (on/off, disabled, light/dark, desktop/mobile, zoom)`);
    } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

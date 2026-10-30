const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {chromium} = require('playwright');
const script = fs.readFileSync('src/webview/fork-player.js', 'utf8').replace('__FORK_FIT_SVG__', fs.readFileSync('images/player/video-scale-fit.svg','utf8').trim());
const executablePath = [process.env.STREMIO_TEST_BROWSER, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(x => x && fs.existsSync(x));
let assets;
async function setup(dark = true, currentDark = dark) {
    assets ||= (async () => {
        const home = await fetch('https://stremio.zarg.me/'); assert.ok(home.ok);
        const html = await home.text();
        return Promise.all(['scripts/main.js', 'styles/main.css'].map(async suffix => {
            const path = html.match(new RegExp(`(?:src|href)="([^"\\s]+/${suffix.replace('.', '\\.')})"`))[1];
            const result = await fetch(new URL(path, 'https://stremio.zarg.me/')); assert.ok(result.ok); return result.text();
        }));
    })();
    const [bundle, css] = await assets;
    const browser = await chromium.launch({executablePath, headless: true});
    const page = await browser.newPage({viewport: {width: 1280, height: 800}});
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.route('https://stremio.zarg.me/**', route => route.fulfill({contentType:'text/html',body:`<html><head><style>${css}</style></head><body><div id="app"></div></body></html>`}));
    await page.addInitScript(({dark, currentDark}) => {
        window.__stremioForkDarkTheme = dark;
        window.messages=[]; window.handlers=[];
        window.native=(name,data)=>window.handlers.forEach(handler=>handler({data:JSON.stringify({args:[name,data]})}));
        window.chrome={webview:{postMessage:text=>{
            const message = JSON.parse(text); window.messages.push(message);
            if (message.args[0] === 'get-theme') queueMicrotask(() => window.native('theme-changed', {dark: currentDark}));
        },addEventListener:(_,handler)=>window.handlers.push(handler)}};
    },{dark,currentDark});
    await page.goto('https://stremio.zarg.me/#/settings');
    const anchor='(()=>{var e;o.g.importScripts'; assert.ok(bundle.includes(anchor));
    await page.addScriptTag({content:bundle.replace(anchor,'window.req=o;window.modules=a;return;'+anchor)});
    await page.evaluate(() => {
        const req=window.req, React=req(30758), ReactDOM=req(99576);
        const find=term=>Object.values(window.modules).find(fn=>fn.toString().includes(term));
        const load=factory=>{const m={exports:{}};factory(m,m.exports,req);return m.exports;};
        const Multiselect=load(Object.values(window.modules).find(fn=>fn.toString().includes('a(48221)') && fn.toString().includes('multiSelect')));
        const settings=load(find('"multiselect-container":"multiselect-container-'));
        const controls=load(find('"seek-bar":"seek-bar-'));
        const slider=load(find('"track-after":"track-after-'));
        const player=load(find('"nav-bar-layer":"nav-bar-layer-'));
        const h=React.createElement;
        function App(){
            const [selected,setSelected]=React.useState(['en']);
            const [multi,setMulti]=React.useState(['en']);
            const row=(title,extra={})=>h('div',{className:settings['option-container']},
                h('div',{className:settings['option-name-container']},h('div',{className:settings.label},title)),
                h(Multiselect,{className:settings['option-input-container']+' '+settings['multiselect-container'],title,options:[{value:'en',label:'English'},{value:'ja',label:'Japanese'}],selected, onSelect:e=>{window.changes=e.value;setSelected([e.value]);},...extra}));
            const icon=(id,color)=>h('svg',{id,viewBox:'0 0 24 24',style:{color,width:32,height:32}},h('path',{fill:'currentColor',d:'M4 4h16v16H4z'}));
            return h(React.Fragment,null,
                h('div',{id:'settings',className:settings['settings-container'],style:{height:650}},h('div',{className:settings['settings-content']},
                    h('div',{className:settings['side-menu-container']},h('button',{'data-section':'player'},'Player')),
                    h('div',{className:settings['sections-container']},h('div',{className:settings['section-container']},h('div',{className:settings['section-title']},'Player'),row('Audio language'),row('Subtitle languages',{multiSelect:true,selected:multi,onSelect:e=>{window.multi=e.value;setMulti([...new Set([...multi,e.value])]);}}))))),
                h('div',{id:'player',className:player['player-container'],style:{position:'relative',height:150}},
                    h('div',{className:player['nav-bar-layer'],style:{height:50}},icon('top-icon','white'),h('span',{id:'stremio-fork-compatibility',style:{color:'orange'}},icon('warning','orange'))),
                    h('div',{className:player['control-bar-layer'],style:{height:100}},icon('bottom-icon','white'),h('div',{className:controls['control-bar-buttons-menu-container']}),
                        h('div',{id:'seek',className:controls['seek-bar']+' '+slider['slider-container'],style:{height:30}},...['track','track-before','track-after','thumb'].map(name=>h('div',{id:'seek-'+name,className:slider[name],style:{width:'50%'}}))),
                        h('div',{id:'volume',className:controls['volume-slider'],style:{width:100}},h('div',{id:'volume-fill',className:slider['track-after']}),h('div',{className:slider.thumb}))),
                    h('div',{id:'subtitle',style:{color:'white'}},'Subtitles stay white')));
        }
        ReactDOM.createRoot(document.getElementById('app')).render(h(App));
    });
    await page.addScriptTag({content:script});
    await page.getByLabel('Control animation speed',{exact:true}).waitFor();
    const color = id => page.locator('#'+id).evaluate(el=>getComputedStyle(el).color);
    return {browser,page,errors,color};
}

test('Dark Mode follows the shell toggle, restores normal colors, and scopes seek/icon colors without tinting subtitles or volume boost',async()=>{
    const {browser,page,errors,color}=await setup();
    try{
        assert.ok(await page.evaluate(()=>window.messages.some(m=>m.args[0]==='get-theme')));
        const background=()=>page.evaluate(()=>getComputedStyle(document.body).backgroundImage);
        assert.ok((await background()).includes('rgb(41, 45, 62)'));
        for(const id of ['top-icon','bottom-icon']) assert.equal(await color(id),'rgb(133, 139, 153)');
        assert.equal(await color('warning'),'rgb(255, 165, 0)');
        assert.equal(await color('subtitle'),'rgb(255, 255, 255)');
        const fill=id=>page.locator('#'+id).evaluate(el=>getComputedStyle(el).backgroundColor);
        assert.equal(await fill('seek-track-after'),'rgb(114, 114, 194)');
        assert.equal(await fill('seek-thumb'),'rgb(114, 114, 194)');
        await page.evaluate(()=>{window.native('display-mode-changed',{mode:'fit',active:true});window.native('mpv-prop-change',{name:'volume',data:120});});
        await page.waitForFunction(()=>document.querySelector('#volume-fill').style.backgroundImage.length > 0);
        const gradient=await page.locator('#volume-fill').evaluate(el=>getComputedStyle(el).backgroundImage);
        assert.ok(gradient.includes('255, 165, 0'));
        assert.equal(await page.locator('#stremio-fork-display-mode svg').evaluate(el=>getComputedStyle(el).color),'rgb(133, 139, 153)');
        fs.mkdirSync('.build-cache/ui-test-evidence',{recursive:true});
        await page.screenshot({path:'.build-cache/ui-test-evidence/theme-dark.png'});
        await page.evaluate(()=>window.native('theme-changed',{dark:false}));
        assert.ok(!(await background()).includes('rgb(41, 45, 62)'));
        assert.equal(await color('top-icon'),'rgb(255, 255, 255)');
        assert.equal(await fill('seek-track-after'),'rgb(114, 114, 194)');
        await page.screenshot({path:'.build-cache/ui-test-evidence/theme-normal.png'});
        await page.evaluate(()=>window.native('theme-changed',{dark:'true'}));
        assert.equal(await page.locator('html').getAttribute('data-stremio-dark-theme'),null);
        await page.evaluate(()=>window.native('theme-changed',{dark:true}));
        assert.equal(await color('bottom-icon'),'rgb(133, 139, 153)');
        assert.deepEqual(errors,[]);
    }finally{await browser.close();}
});

test('A fresh document requests the current shell theme rather than retaining a stale startup snapshot; bootstrap stays idempotent',async()=>{
    const {browser,page,errors,color}=await setup(true,false);
    try{
        assert.equal(await page.locator('html').getAttribute('data-stremio-dark-theme'),null);
        assert.equal(await color('top-icon'),'rgb(255, 255, 255)');
        await page.addScriptTag({content:script});
        assert.equal(await page.locator('#stremio-fork-theme').count(),1);
        assert.equal(await page.evaluate(()=>window.messages.filter(m=>m.args[0]==='get-theme').length),1);
        assert.deepEqual(errors,[]);
    }finally{await browser.close();}
});

test('Live settings dropdowns share animation-selector styling and preserve click, keyboard, multiple selection and narrow layouts',async()=>{
    const {browser,page,errors}=await setup(false);
    try{
        const dropdown=page.locator('[class*="option-input-container"][class*="multiselect-container"]');
        const animation=page.getByLabel('Control animation speed',{exact:true});
        const appearance=el=>{const s=getComputedStyle(el);return {border:s.border,borderRadius:s.borderRadius,background:s.backgroundColor,minHeight:s.minHeight,padding:s.padding};};
        assert.deepEqual(await dropdown.first().evaluate(appearance),await animation.evaluate(appearance));
        await dropdown.first().click();
        const japanese=page.locator('[data-value="ja"]').filter({visible:true});
        await japanese.click();
        assert.equal(await page.evaluate(()=>window.changes),'ja');
        assert.ok((await dropdown.first().innerText()).includes('Japanese'));
        await dropdown.last().focus(); await page.keyboard.press('Enter');
        await page.locator('[data-value="ja"]').filter({visible:true}).focus(); await page.keyboard.press('Enter');
        assert.equal(await page.evaluate(()=>window.multi),'ja');
        assert.ok((await dropdown.last().innerText()).includes('English, Japanese'));
        await page.keyboard.press('Escape'); await page.mouse.click(20,20);
        fs.mkdirSync('.build-cache/ui-test-evidence',{recursive:true});
        for(const width of [1280,800,600,360]){
            await page.setViewportSize({width,height:800});
            for(const el of [dropdown.first(),dropdown.last(),animation]){
                const box=await el.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width+1,`Dropdown fits at ${width}`);
            }
            await page.screenshot({path:`.build-cache/ui-test-evidence/theme-settings-${width}.png`});
        }
        assert.deepEqual(errors,[]);
    }finally{await browser.close();}
});

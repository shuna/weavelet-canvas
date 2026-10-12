const { chromium } = require('@playwright/test');
const fs = require('node:fs');
(async () => {
  const browser = await chromium.launch({headless:true, executablePath:process.env.PLAYWRIGHT_CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:5175/', {waitUntil:'networkidle'});
    const result = await page.evaluate(async () => {
      const {addContent} = await import('/src/utils/contentStore.ts');
      const {materializeActivePath} = await import('/src/utils/branchUtils.ts');
      const {searchBranchNodes} = await import('/src/utils/branchSearch.ts');
      const {compressChatRecord,decompressChatRecord} = await import('/src/store/storage/CompressionService.ts');
      const contentStore={}, entries=[];
      for(let c=0;c<50;c++) {
        const nodes={},activePath=[];
        for(let n=0;n<100;n++) {
          const id=`c${c}-n${n}`; activePath.push(id);
          nodes[id]={id,parentId:n?activePath[n-1]:null,role:n%2?'assistant':'user',createdAt:n,
            contentHash:addContent(contentStore,[{type:'text',text:`chat ${c} node ${n} ${n===50?'needle ':''}`+'synthetic text '.repeat(64)}])};
        }
        entries.push({chatIndex:c,tree:{nodes,rootId:activePath[0],activePath}});
      }
      const run = async (fn,count=20) => {
        await fn(); const samples=[];
        for(let i=0;i<count;i++){const t=performance.now();await fn();samples.push(performance.now()-t);}
        samples.sort((a,b)=>a-b);return {iterations:count,p50_ms:samples[Math.floor(count/2)],p95_ms:samples[Math.ceil(count*.95)-1],samples_ms:samples};
      };
      const search = await run(()=>{const r=searchBranchNodes('needle',entries,contentStore,'all');if(r.length!==50)throw Error('search fixture mismatch');});
      const materialize = await run(()=>{for(const e of entries){if(materializeActivePath(e.tree,contentStore).length!==100)throw Error('materialization mismatch');}});
      const snapshot={entries,contentStore};const raw=JSON.stringify(snapshot);const packed=await compressChatRecord(snapshot);
      if(JSON.stringify(await decompressChatRecord(packed))!==raw)throw Error('compression roundtrip mismatch');
      const compression=await run(()=>compressChatRecord(snapshot),10);
      const decompression=await run(()=>decompressChatRecord(packed),10);
      return {fixture:{chats:50,nodes_per_chat:100,nodes:5000,text_repeat:64,query:'needle',expected_results:50},browser:navigator.userAgent,search,materialize,compression,decompression,raw_bytes:new TextEncoder().encode(raw).length,packed_bytes:packed.byteLength};
    });
    fs.writeFileSync(process.argv[2] || '/tmp/weavelet-browser-baseline.json',JSON.stringify(result,null,2)+'\n');
    console.log(JSON.stringify({...result,search:{p50_ms:result.search.p50_ms,p95_ms:result.search.p95_ms},materialize:{p50_ms:result.materialize.p50_ms,p95_ms:result.materialize.p95_ms},compression:{p50_ms:result.compression.p50_ms,p95_ms:result.compression.p95_ms},decompression:{p50_ms:result.decompression.p50_ms,p95_ms:result.decompression.p95_ms}}));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

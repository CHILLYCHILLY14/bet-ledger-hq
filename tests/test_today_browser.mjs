import {chromium} from "playwright";
import {createServer} from "node:http";
import {readFile,mkdir} from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const root=process.cwd();
const server=createServer(async(req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,"http://localhost").pathname),rel=pathname.replace(/^\/bet-ledger-hq\//,"");
  const file=path.resolve(root,rel===""?"index.html":rel);
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  try{const data=await readFile(file);res.setHeader("Content-Type",file.endsWith(".css")?"text/css":file.endsWith(".js")?"text/javascript":file.endsWith(".json")?"application/json":"text/html");res.end(data);}
  catch(_){res.writeHead(404);res.end("Not found");}
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const origin="http://127.0.0.1:"+server.address().port;
const browser=await chromium.launch({headless:true});
try{
  for(const width of [320,393,1440]){
    const context=await browser.newContext({viewport:{width,height:900}});
    const page=await context.newPage(),errors=[];
    page.on("pageerror",e=>errors.push(e.message));
    const stamp=new Date().toISOString(),start=new Date(Date.now()+3600000).toISOString();
    const chosen=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Toronto",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(start));
    await page.route("**/data/**",route=>{
      const u=route.request().url();let data={generated_at:stamp};
      if(u.includes("board.json"))data=[{game_id:"1",game_date:start,tier:"GOOD",stake:2,price:-110,matchup:"DEN @ KC",pick:"DEN ML",book:"DraftKings"}];
      if(u.includes("latest.json"))data={generated_at:stamp,games:[]};
      if(u.includes("accuracy.json"))data={generated_at:stamp,scope:{season:2026,season_type_label:"regular season"},games:{winner:{n:15,correct:11,accuracy:11/15}}};
      return route.fulfill({contentType:"application/json",body:JSON.stringify(data)});
    });
    await page.goto(origin+"/bet-ledger-hq/");
    const frame=page.frameLocator("#frame-today");
    await frame.locator("#refresh-status").filter({hasText:"Published files checked"}).waitFor();
    await frame.locator("#date").fill(chosen);
    await frame.locator("#date").dispatchEvent("change");
    await frame.getByRole("heading",{name:"DEN ML",exact:true}).first().waitFor();
    await frame.getByRole("button",{name:"Accuracy",exact:true}).click();
    await frame.getByRole("heading",{name:"Predictions, not your bet record"}).waitFor({state:"visible"});
    await frame.getByRole("button",{name:"Exposure",exact:true}).click();
    await frame.getByText("Connect and sync in Ledger").waitFor();
    assert.equal(await page.locator(".board-link").count(),7);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const child=page.frames().find(f=>f.url().endsWith("today.html"));
    assert.ok(await child.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.getByRole("link",{name:"Ledger",exact:true}).click();
    await page.locator("#frame-ledger").waitFor({state:"visible"});
    await page.getByRole("link",{name:"Today",exact:true}).click();
    await page.locator("#frame-today").waitFor({state:"visible"});
    assert.equal(await frame.getByRole("button",{name:"Exposure",exact:true}).getAttribute("aria-pressed"),"true");
    await frame.getByRole("button",{name:"Today's board",exact:true}).click();
    await mkdir("test-results",{recursive:true});
    await page.screenshot({path:"test-results/today-"+width+".png"});
    assert.deepEqual(errors,[]);
    await context.close();
  }
  console.log("Desktop and 320/393px mobile smoke checks passed.");
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}

const canvas=document.getElementById("simCanvas"),ctx=canvas.getContext("2d");
const W=900,H=570,STEP=50;
let running=false,paused=false,tick=0,missionTime=0,packetPhase=0;
let detections=0,investigations=0,reassignments=0,messages=0,relayMessages=0;
let scenario="normal",commsDegraded=false,missionComplete=false,last=0;

const baseTargets=[
["Victim-01",190,120,"victim"],["Victim-02",445,150,"victim"],["Victim-03",720,125,"victim"],
["Victim-04",625,430,"victim"],["Victim-05",275,420,"victim"],
["Hazard-01",350,270,"hazard"],["Hazard-02",700,310,"hazard"],["Hazard-03",500,455,"hazard"]];
let targets=[];
const makeTargets=()=>baseTargets.map(([name,x,y,type])=>({name,x,y,type,detected:false,investigated:false,detectedBy:null}));
const makeNodes=()=>[
{name:"O1",x:450,y:95,hx:450,hy:95,battery:98,role:"Observer",baseRole:"Observer",speed:2.5,color:"#168cff",target:null,status:"READY",path:[]},
{name:"I1",x:180,y:500,hx:180,hy:500,battery:96,role:"Investigator",baseRole:"Investigator",speed:3,color:"#ff4d5a",target:null,status:"READY",path:[]},
{name:"I2",x:720,y:500,hx:720,hy:500,battery:96,role:"Investigator",baseRole:"Investigator",speed:3,color:"#ff8a4d",target:null,status:"READY",path:[]}
];
let nodes=[],queue=[],assigned={},completed=new Set();

function reset(clear=true){
  running=false;paused=false;tick=0;missionTime=0;packetPhase=0;
  detections=0;investigations=0;reassignments=0;messages=0;relayMessages=0;missionComplete=false;
  targets=makeTargets();nodes=makeNodes();queue=[];assigned={};completed=new Set();
  commsDegraded=false;
  document.getElementById("scenarioBadge").textContent="NORMAL SEARCH";
  if(clear)document.getElementById("log").textContent="";
  panels();draw();
}
function node(n){return nodes.find(x=>x.name===n)}
function D(a,b,c,d){return Math.hypot(c-a,d-b)}
function log(m,c="INFO"){
 const p={AI:"[AI   ]",TASK:"[TASK ]",COMMS:"[MESH ]",WARN:"[WARN ]",OK:"[ OK  ]",INFO:"[INFO ]"}[c]||"[INFO ]";
 const el=document.getElementById("log");el.textContent+=p+" "+m+"\n";el.scrollTop=el.scrollHeight;
}
function start(){
 reset(true);running=true;
 log("MISSION STARTED - WORLD MODEL ONLINE","OK");
 log("O1 assigned as wide-area Observer","TASK");
 log("I1 + I2 assigned as parallel Investigators","TASK");
 log("TASK ALLOCATOR: location + battery + risk + priority","AI");
 log("FULL MESH COMMUNICATION ENABLED","COMMS");
 requestAnimationFrame(loop);
}
function pauseResume(){
 if(!running)return;paused=!paused;
 log(paused?"Simulation paused":"Simulation resumed","INFO");
 if(!paused){last=0;requestAnimationFrame(loop)}
}
function applyScenario(){
 scenario=document.getElementById("scenario").value;
 const labels={normal:"NORMAL SEARCH",lowbattery:"I1 LOW BATTERY",failure:"I1 UAV UNAVAILABLE",hazard:"HAZARD PRIORITY",comms:"COMMUNICATION DEGRADED"};
 document.getElementById("scenarioBadge").textContent=labels[scenario];
 if(scenario==="lowbattery"){node("I1").battery=10;log("SCENARIO: I1 battery reduced to 10%","WARN")}
 if(scenario==="failure"){node("I1").battery=0;node("I1").status="UAV UNAVAILABLE";node("I1").target=null;log("SCENARIO: I1 unavailable - allocator must recover unfinished work","WARN")}
 if(scenario==="hazard"){log("SCENARIO: hazard priority enabled; observer continues hazard reporting","WARN")}
 if(scenario==="comms"){commsDegraded=true;log("SCENARIO: communication degraded - telemetry rate reduced","WARN")}
 panels();draw();
}
function queueVictim(t){
 if(completed.has(t.name)||assigned[t.name])return;
 if(!queue.includes(t))queue.push(t);
 dispatch();
}
function dispatch(){
 let avail=nodes.filter(n=>n.role==="Investigator"&&n.battery>12&&n.status!=="RETURN TO BASE"&&n.status!=="UAV UNAVAILABLE");
 let idle=avail.filter(n=>!n.target);
 while(queue.length&&idle.length){
   const t=queue.shift();
   if(t.investigated||assigned[t.name])continue;
   idle.sort((a,b)=>D(a.x,a.y,t.x,t.y)-D(b.x,b.y,t.x,t.y));
   const n=idle.shift();
   n.target={x:t.x,y:t.y};n.status="INVESTIGATE -> "+t.name;assigned[t.name]=n.name;messages++;
   log(`${n.name} received ${t.name} coordinates from world model`,"COMMS");
   log(`Allocator → ${n.name}: investigate ${t.name}`,"TASK");
 }
}
function observer(){
 const o=node("O1");if(o.battery<=8){o.status="LOW BATTERY - SAFE HOLD";return}
 if(!o.target){
   let c=targets.filter(t=>!t.detected);
   c.sort((a,b)=>D(o.x,o.y,a.x,a.y)-D(o.x,o.y,b.x,b.y));
   if(c.length){o.target={x:c[0].x,y:c[0].y};o.status="SCAN -> "+c[0].name}else o.status="AREA SCAN COMPLETE";
 }
 for(const t of targets){
   if(t.detected)continue;
   if(D(o.x,o.y,t.x,t.y)<=65){
    t.detected=true;t.detectedBy="O1";detections++;messages++;
    if(o.target&&o.target.x===t.x&&o.target.y===t.y)o.target=null;
    if(t.type==="victim"){log(`O1 detected ${t.name} at (${t.x},${t.y})`,"AI");log(`O1 → mesh: ${t.name} coordinates broadcast`,"COMMS");queueVictim(t)}
    else log(`O1 detected ${t.name}; hazard alert broadcast`,"WARN");
   }
 }
 if(targets.every(t=>t.detected))o.status="AREA SCAN COMPLETE";
}
function move(n){
 if(!n.target)return;
 const dx=n.target.x-n.x,dy=n.target.y-n.y,d=Math.hypot(dx,dy);
 if(d<=3){n.x=n.target.x;n.y=n.target.y;return}
 const s=Math.min(n.speed,d),ox=n.x,oy=n.y;
 n.x+=dx/d*s;n.y+=dy/d*s;n.battery=Math.max(0,n.battery-Math.hypot(n.x-ox,n.y-oy)*.012);
 n.path.push({x:n.x,y:n.y});if(n.path.length>100)n.path.shift();
}
function moveAll(){
 nodes.forEach(n=>{
  move(n);
  if(n.role==="Observer"&&!n.target)n.status=targets.every(t=>t.detected)?"AREA SCAN COMPLETE":"AREA MONITORING";
  if(n.role==="Investigator"&&n.status==="RETURN TO BASE"&&D(n.x,n.y,n.hx,n.hy)<10){n.x=n.hx;n.y=n.hy;n.target=null;n.status="SAFE / RETURNED"}
 })
}
function investigate(){
 for(const n of nodes.filter(x=>x.role==="Investigator")){
  if(!n.target)continue;
  let vn=Object.keys(assigned).find(k=>assigned[k]===n.name);
  if(!vn){n.target=null;continue}
  const t=targets.find(x=>x.name===vn);if(!t){n.target=null;continue}
  if(D(n.x,n.y,t.x,t.y)<=20){
   t.investigated=true;completed.add(t.name);investigations++;messages++;delete assigned[t.name];
   n.target=null;n.status="VERIFIED -> "+t.name;
   log(`${n.name} investigated ${t.name}`,"OK");log(`${n.name} → ALL NODES: ${t.name} VERIFIED`,"COMMS");
  }
 }
 dispatch();
}
function adapt(){
 for(const n of nodes.filter(x=>x.role==="Investigator")){
  if(n.status==="UAV UNAVAILABLE"){
   const vn=Object.keys(assigned).find(k=>assigned[k]===n.name);
   if(vn){const t=targets.find(x=>x.name===vn);if(t&&!t.investigated&&!queue.includes(t))queue.unshift(t);delete assigned[vn]}
   n.role="Unavailable";reassignments++;messages++;
   log("I1 unavailable → unfinished work returned to allocator","WARN");
   log("Task allocator searching for another capable UAV","AI");
   continue;
  }
  if(n.battery<=12&&n.status!=="RETURN TO BASE"&&n.status!=="SAFE / RETURNED"){
   const vn=Object.keys(assigned).find(k=>assigned[k]===n.name);
   if(vn){const t=targets.find(x=>x.name===vn);if(t&&!t.investigated&&!queue.includes(t))queue.unshift(t);delete assigned[vn];log(`${n.name} low battery → task requeued`,"WARN")}
   n.target={x:n.hx,y:n.hy};n.status="RETURN TO BASE";reassignments++;messages++;
   log(`${n.name} → RETURN TO BASE; allocator adapts mission plan`,"TASK");
  }
 }
 dispatch();
}
function comms(){
 if(tick%8===0){
  const links=nodes.length*(nodes.length-1);
  const factor=commsDegraded?.5:1;
  messages+=Math.floor(links*factor);relayMessages+=Math.floor(nodes.length*factor);
  if(tick%40===0)log(commsDegraded?"DEGRADED LINK heartbeat: telemetry reduced":"FULL MESH heartbeat: all UAV-to-UAV links active","COMMS");
 }
}
function complete(){
 const v=targets.filter(t=>t.type==="victim");
 if(v.every(t=>t.investigated)&&!missionComplete){missionComplete=true;running=false;log("MISSION COMPLETE - ALL VICTIMS VERIFIED","OK");log("World model: final situation update received","COMMS")}
}
function panels(){
 const v=targets.filter(t=>t.type==="victim"),h=targets.filter(t=>t.type==="hazard");
 document.getElementById("metrics").textContent=
`MISSION TIME : ${missionTime.toFixed(1).padStart(5,"0")}s
NODES ONLINE : ${nodes.filter(n=>n.role!=="Unavailable").length}/3
ARCHITECTURE : 1 Observer + 2 Investigators
MESH LINKS   : ${nodes.length*(nodes.length-1)}
DETECTIONS   : ${detections}
VICTIMS      : ${v.filter(t=>t.detected).length}/${v.length}
INVESTIGATED : ${investigations}/${v.length}
QUEUED TASKS : ${queue.length}
ACTIVE TASKS : ${Object.keys(assigned).length}
HAZARDS      : ${h.filter(t=>t.detected).length}/${h.length}
REASSIGNED   : ${reassignments}
MESSAGES     : ${messages}
RELAY        : R1
COMMS        : ${commsDegraded?"DEGRADED":"NORMAL"}
MISSION      : ${missionComplete?"COMPLETE":"RUNNING"}`;
 document.getElementById("allocator").textContent=
`PERCEPTION  → ${detections} detections
WORLD MODEL → ${Object.keys(assigned).length+queue.length} pending tasks
ALLOCATOR   → location + battery + risk + priority
ACTIVE      → ${Object.entries(assigned).map(([t,n])=>n+"→"+t).join(", ")||"none"}
ADAPTATION  → ${reassignments} reassignment(s)
FEEDBACK    → live situation updates`;
 document.getElementById("nodes").textContent=nodes.map(n=>
`${n.name} ${n.battery.toFixed(1).padStart(5)}% ${n.role.padEnd(13)}
   ${n.status}`).join("\n");
}
function draw(){
 ctx.clearRect(0,0,W,H);ctx.fillStyle="#111b26";ctx.fillRect(0,0,W,H);
 ctx.strokeStyle="#1d2a38";ctx.lineWidth=1;
 for(let x=20;x<W;x+=40){ctx.beginPath();ctx.moveTo(x,45);ctx.lineTo(x,H-20);ctx.stroke()}
 for(let y=45;y<H-20;y+=40){ctx.beginPath();ctx.moveTo(15,y);ctx.lineTo(W-15,y);ctx.stroke()}
 ctx.fillStyle="#e8f1f7";ctx.font="bold 14px Arial";ctx.textAlign="center";ctx.fillText("LIVE DISASTER AREA / DISTRIBUTED UAV MESH",450,18);
 ctx.strokeStyle="#304456";ctx.setLineDash([4,5]);ctx.strokeRect(20,55,875,480);ctx.setLineDash([]);
 ctx.fillStyle="#71889a";ctx.font="bold 8px Arial";ctx.textAlign="left";ctx.fillText("WORLD MODEL / SEARCH AREA",30,67);
 drawRelay();drawMesh();
 targets.forEach(t=>t.type==="victim"?drawVictim(t):drawHazard(t));
 nodes.forEach(drawTrail);nodes.forEach(drawNode);legend();
}
function drawRelay(){
 ctx.strokeStyle="#b56cff";ctx.setLineDash([4,5]);ctx.beginPath();ctx.arc(450,285,95,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
 ctx.fillStyle="#8d4de8";ctx.fillRect(434,273,32,24);ctx.strokeStyle="white";ctx.strokeRect(434,273,32,24);
 ctx.beginPath();ctx.moveTo(450,273);ctx.lineTo(450,257);ctx.stroke();ctx.fillStyle="#d9a6ff";ctx.beginPath();ctx.arc(450,253,4,0,Math.PI*2);ctx.fill();
 ctx.fillStyle="#d9a6ff";ctx.font="bold 8px Arial";ctx.textAlign="center";ctx.fillText("R1 - RELAY / COMMS",450,315);
}
function drawMesh(){
 for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){
  const a=nodes[i],b=nodes[j];ctx.strokeStyle=commsDegraded?"#8d6b3b":"#1f7b62";ctx.setLineDash([5,6]);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.setLineDash([]);
  const p=(packetPhase+i*.11+j*.07)%1,px=a.x+(b.x-a.x)*p,py=a.y+(b.y-a.y)*p;
  ctx.fillStyle=commsDegraded?"#ffb84d":"#54e5ad";ctx.beginPath();ctx.arc(px,py,3,0,Math.PI*2);ctx.fill();
 }
 ctx.fillStyle=commsDegraded?"#ffb84d":"#42d99a";ctx.font="bold 8px Arial";ctx.textAlign="center";ctx.fillText(commsDegraded?"DEGRADED COMMUNICATION / FALLBACK TELEMETRY":"ALL-NODE MESH COMMUNICATION",450,365);
}
function drawTrail(n){if(n.path.length<2)return;ctx.strokeStyle=n.color;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(n.path[0].x,n.path[0].y);n.path.slice(1).forEach(p=>ctx.lineTo(p.x,p.y));ctx.stroke()}
function drawNode(n){
 if(n.role==="Observer"){ctx.strokeStyle=n.color;ctx.setLineDash([2,4]);ctx.beginPath();ctx.arc(n.x,n.y,65,0,Math.PI*2);ctx.stroke();ctx.setLineDash([])}
 if(n.target){ctx.strokeStyle=n.color;ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(n.x,n.y);ctx.lineTo(n.target.x,n.target.y);ctx.stroke();ctx.setLineDash([])}
 ctx.fillStyle=n.role==="Unavailable"?"#68727c":n.color;ctx.strokeStyle="white";ctx.lineWidth=2;ctx.beginPath();ctx.arc(n.x,n.y,14,0,Math.PI*2);ctx.fill();ctx.stroke();
 ctx.strokeStyle="white";ctx.beginPath();ctx.moveTo(n.x-18,n.y-18);ctx.lineTo(n.x+18,n.y+18);ctx.stroke();ctx.beginPath();ctx.moveTo(n.x-18,n.y+18);ctx.lineTo(n.x+18,n.y-18);ctx.stroke();
 ctx.fillStyle="white";ctx.font="bold 8px Arial";ctx.textAlign="center";ctx.fillText(n.name,n.x,n.y+3);
 ctx.fillStyle=n.role==="Unavailable"?"#aab3ba":n.color;ctx.fillText(n.role,n.x,n.y+27);
 const bx=n.x-28,by=n.y-30;ctx.fillStyle="#263442";ctx.fillRect(bx,by,56,6);ctx.fillStyle=n.battery<20?"#ff3d4d":n.battery<40?"#ffc857":"#37d383";ctx.fillRect(bx,by,56*Math.max(0,Math.min(100,n.battery))/100,6);
 ctx.fillStyle="#dce7ee";ctx.font="7px Arial";ctx.fillText(Math.round(n.battery)+"%",n.x,by-8);
}
function drawVictim(t){const c=t.investigated?"#66717b":t.detected?"#ffd447":"#ff5b9a";ctx.fillStyle=c;ctx.strokeStyle="white";ctx.beginPath();ctx.arc(t.x,t.y,9,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle="#111b26";ctx.beginPath();ctx.arc(t.x,t.y-3,3,0,Math.PI*2);ctx.fill();ctx.fillRect(t.x-1,t.y,2,7);ctx.fillStyle="#edf4f8";ctx.font="bold 8px Arial";ctx.textAlign="center";ctx.fillText(t.name+(t.detected?" ✓":""),t.x,t.y-20)}
function drawHazard(t){const c=t.detected?"#ff3d30":"#ff9d2e";ctx.fillStyle=c;ctx.strokeStyle="white";ctx.beginPath();ctx.moveTo(t.x,t.y-13);ctx.lineTo(t.x-12,t.y+10);ctx.lineTo(t.x+12,t.y+10);ctx.closePath();ctx.fill();ctx.stroke();ctx.fillStyle="white";ctx.font="bold 10px Arial";ctx.textAlign="center";ctx.fillText("!",t.x,t.y+4);ctx.font="bold 8px Arial";ctx.fillStyle="#edf4f8";ctx.fillText(t.name+(t.detected?" ✓":""),t.x,t.y+22)}
function legend(){const x=20,y=492;ctx.fillStyle="#0e151d";ctx.fillRect(x,y,360,58);const e=[["#168cff","Observer"],["#ff4d5a","Investigator"],["#ff8a4d","Investigator I2"],["#54e5ad","Mesh packet"],["#8d4de8","Relay"],["#ff5b9a","Victim"],["#ff9d2e","Hazard"]];e.forEach((z,i)=>{let col=i%3,row=Math.floor(i/3),xx=x+10+col*115,yy=y+16+row*25;ctx.fillStyle=z[0];ctx.beginPath();ctx.arc(xx,yy,4,0,Math.PI*2);ctx.fill();ctx.fillStyle="#dce7ee";ctx.font="7px Arial";ctx.textAlign="left";ctx.fillText(z[1],xx+7,yy+2)})}
function loop(now){
 if(!running||paused)return;if(!last)last=now;
 if(now-last>=STEP){last=now;tick++;missionTime+=STEP/1000;packetPhase=(packetPhase+.04)%1;observer();moveAll();investigate();adapt();comms();complete();panels();draw()}
 requestAnimationFrame(loop)
}
document.getElementById("startBtn").onclick=start;
document.getElementById("pauseBtn").onclick=pauseResume;
document.getElementById("applyScenario").onclick=applyScenario;
document.getElementById("messageBtn").onclick=()=>{messages++;log("TEST MESSAGE: I1 → ALL NODES","COMMS");panels()};
reset(false);

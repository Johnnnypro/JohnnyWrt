// Disposable-guest fixtures generated from the same planner used by LuCI.
const fs=require('node:fs');
const model=new Function('baseclass',fs.readFileSync(`${__dirname}/johnny-model.js`,'utf8'))({extend:x=>x});
const env={ports:['eth0','eth1'],bridge:'fixture_bridge',lanZone:'fixture_lan',wanZone:'fixture_wan',interfaces:['lan','wan','wan6','zerotier']};
const base={role:'bypass',lanPorts:['eth0'],wanPort:'eth1',protocol:'dhcp',address:'192.168.50.1',mask:'255.255.255.0',gateway:'192.168.50.254',dns:['1.1.1.1'],wanAddress:'192.0.2.2',wanMask:'255.255.255.0',wanGateway:'192.0.2.1',username:'test-only',password:'test-only'};
const cases=[['bypass','dhcp'],['bypass','static'],['main','dhcp'],['main','static'],['main','pppoe']].map(([role,protocol])=>({role,protocol,...model.networkPlan({...base,role,protocol},env)}));
fs.writeFileSync(process.argv[2],JSON.stringify(cases,null,2)+'\n');

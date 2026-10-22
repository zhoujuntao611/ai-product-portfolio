type PrivacyResolve = (result:{event:'agree'|'disagree';buttonId?:string})=>void;
type PrivacyView = {setData(data:Record<string,unknown>):void};
let active:PrivacyView|null=null;
let pending:PrivacyResolve[]=[];
let installed=false;
function settle(view:PrivacyView,agree:boolean){
  if(active!==view)return;
  view.setData({visible:false});
  const callbacks=pending;pending=[];
  for(const resolve of callbacks)resolve(agree?{event:'agree',buttonId:'panji-privacy-agree'}:{event:'disagree'});
}
function install(){
  if(installed||typeof wx.onNeedPrivacyAuthorization!=='function')return;
  installed=true;
  // The published typings misdeclare the callback parameter as a result object.
  const listen=wx.onNeedPrivacyAuthorization as unknown as (listener:(resolve:PrivacyResolve)=>void)=>void;
  listen(resolve=>{
    if(!active){resolve({event:'disagree'});return;}
    pending.push(resolve);const view=active;view.setData({visible:true});
    wx.getPrivacySetting({success:r=>{if(active===view)view.setData({contractName:r.privacyContractName||'用户隐私保护指引'});}});
  });
}
Component({
  data:{visible:false,contractName:'用户隐私保护指引'},
  lifetimes:{
    attached(){install();active=this;},
    detached(){if(active===this){settle(this,false);active=null;}},
  },
  pageLifetimes:{show(){active=this;},hide(){if(active===this){settle(this,false);active=null;}}},
  methods:{
    agree(){settle(this,true);},
    decline(){settle(this,false);},
    contract(){wx.openPrivacyContract({fail:()=>wx.showToast({title:'暂时无法打开，请稍后重试',icon:'none'})});},
    stop(){},
  },
});

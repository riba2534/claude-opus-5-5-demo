// 全部自写 GLSL：PBR 材质注入、地面程序化图案、天空云层、粒子光束、后处理链
// 没有任何图片素材——纹理只有运行时生成的噪声 DataTexture 和 Canvas 2D 画出来的招牌图集

// ---------- 注入 three 标准 PBR 材质的公共片元段 ----------
export const PARS = `
varying vec3 vWp;
uniform float uTime,uNight,uFogK;uniform sampler2D tNoise;uniform vec3 uHor,uGlow,uSunD;
float hash21(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
// 路灯位置是解析的（沿十字路与环路等距排布），任何表面都能直接算出灯光池，不需要逐灯循环
float lamps(vec2 p){
  float dx=abs(p.x),dz=abs(p.y),r=length(p);
  float lon=max(dx,dz),lat=min(dx,dz);
  float lo=clamp(floor((lon-32.)/14.+.5),0.,6.)*14.+32.;
  vec2 d=vec2(lon-lo,lat-6.4);
  float a=exp(-dot(d,d)*.05)*step(7.,abs(lo-78.));
  float an=atan(p.y,p.x),k=floor(an/6.2831853*32.+.5)*6.2831853/32.;
  vec2 lp=vec2(cos(k),sin(k));
  vec2 q=p-lp*(78.+6.4*sign(r-78.));
  a+=exp(-dot(q,q)*.05)*step(9.,min(abs(lp.x),abs(lp.y))*78.);
  return a*uNight;}
vec3 hzc(vec3 d){vec3 e=normalize(vec3(d.x,0.,d.z)+1e-5);return uHor+uGlow*pow(max(dot(e,normalize(vec3(uSunD.x,0.,uSunD.z)+1e-5)),0.),5.);}
`;
// 顶点注入：材质参数、每实例颜色/特效、植被摆动、世界坐标
export const V_PARS = `
attribute vec4 aM;
#ifdef USE_INSTANCING
attribute vec4 iT;
#endif
varying vec4 vM,vT;varying vec3 vWp;uniform float uTime;
`;
export const V_BEGIN = `
transformed.xz+=aM.z*vec2(sin(uTime*1.6+position.x*.3+position.z*.2),cos(uTime*1.3+position.z*.3))*.25;
`;
export const V_END = `
vM=aM;
#ifdef USE_INSTANCING
vT=iT;vWp=(modelMatrix*instanceMatrix*vec4(transformed,1.)).xyz;
#else
vT=vec4(1.,1.,1.,0.);vWp=(modelMatrix*vec4(transformed,1.)).xyz;
#endif
`;
// 物体材质：顶点色反照率 + 自发光 + 数字溶解 + 建筑窗户 + 噪声微观变化
export const F_OBJ = `
vec3 dA=pow(vColor.rgb,vec3(2.2))*vT.rgb;
float dG=vM.x,dMt=step(.25,vM.y)*step(vM.y,.75),dF=max(vT.a,0.);
vec3 dEm=dA*vColor.a*mix(1.,uNight,vM.w)*5.5;
if(vT.a<0.){
  // 数字溶解：按世界空间小方块逐块消失，边缘发青光（敌人生成/死亡）
  float k=hash21(floor(vWp.xy*10.)+floor(vWp.z*10.)*7.31);
  if(k<-vT.a)discard;
  if(k<.12-vT.a)dEm+=vec3(.3,2.,4.);}
vec3 wN=normalize((vec4(normalize(vNormal),0.)*viewMatrix).xyz);
vec3 nz=texture2D(tNoise,(abs(wN.y)>.6?vWp.xz:(abs(wN.x)>.6?vWp.zy:vWp.xy))*.31).rgb;
dA*=.9+.2*nz.r;dG*=.82+.36*nz.g;
if(vM.y>.75&&abs(wN.y)<.3){
  // 建筑窗户：按世界坐标划分格子，夜晚按哈希随机点亮；玻璃走真实 PBR 反射天空
  vec2 u=vec2(dot(vWp.xz,vec2(-wN.z,wN.x)),vWp.y)/vec2(2.6,3.2);vec2 f=fract(u),w=fwidth(u)*1.2;
  float m=smoothstep(.15-w.x,.15+w.x,f.x)*smoothstep(.85+w.x,.85-w.x,f.x)*smoothstep(.2-w.y,.2+w.y,f.y)*smoothstep(.8+w.y,.8-w.y,f.y);
  m*=1.-smoothstep(.2,.55,max(w.x,w.y));
  vec2 id=floor(u)+floor(wN.xz*3.+.5)*17.;
  float on=step(.5,hash21(id))*uNight;
  dA=mix(dA,vec3(.02,.035,.06),m);dG=mix(dG,.97,m);dMt=mix(dMt,.6,m);
  dEm+=m*on*mix(vec3(1.,.6,.26),vec3(.5,.8,1.),step(.8,hash21(id+5.)))*(.4+.8*hash21(id+9.));}
diffuseColor.rgb*=dA;
`;
export const F_ROUGH = `float roughnessFactor=clamp(1.-dG*.94,.05,1.);`;
export const F_METAL = `float metalnessFactor=dMt;`;
export const F_EMIS = `totalEmissiveRadiance+=dEm;`;
export const F_LAMP = `reflectedLight.directDiffuse+=material.diffuseColor*vec3(1.,.7,.4)*lamps(vWp.xz)*.55*smoothstep(7.5,3.,vWp.y);`;
export const F_OUT = `
gl_FragColor.rgb=mix(gl_FragColor.rgb,vec3(4.),dF);
{vec3 fd=vWp-cameraPosition;gl_FragColor.rgb=mix(gl_FragColor.rgb,hzc(fd),1.-exp(-pow(length(fd)*uFogK,1.5)));}
`;

// ---------- 地面：道路、标线、自行车道、斑马线、广场石板、草地、滑板公园涂装，全部按世界坐标程序化生成 ----------
export const F_GROUND_PARS = `
float ln(float d,float w,float a){return smoothstep(w+a,w-a,abs(d));}
`;
export const F_GROUND = `
vec2 p=vWp.xz;float r=length(p),aa=length(fwidth(p))*.75+.002;
float dx=abs(p.x),dz=abs(p.y),dr=abs(r-78.),dc=min(dx,dz),dR=min(dc,dr);
float inA=smoothstep(125.+aa,125.-aa,r);
float road=smoothstep(5.+aa,5.-aa,dR)*inA,walk=smoothstep(6.8+aa,6.8-aa,dR)*inA,plz=smoothstep(26.+aa,26.-aa,r);
vec4 t1=texture2D(tNoise,p*.021),t2=texture2D(tNoise,p*.19),t3=texture2D(tNoise,p*1.3);
float n1=t1.r,n2=t2.r,n3=t3.a;
float sx=step(0.,p.x),sz=step(0.,p.y),inner=step(r,78.);
float grassZ=mix(1.,inner>.5?(1.-sx)*sz:abs(sx+sz-1.)<.5?0.:1.,step(r,125.));
float skate=inner*(1.-sx)*(1.-sz),yard=inner*sx*(1.-sz);
// 草地：多尺度噪声 + 修剪条纹
vec3 gr=mix(vec3(.05,.17,.03),vec3(.17,.33,.06),n1)*(.75+.5*n2)*(.8+.4*t3.r);
gr*=1.+.08*sin((p.x+p.y)*1.1)*step(r,125.);
gr=mix(gr,vec3(.28,.3,.08),smoothstep(.6,.95,n3)*.22);
gr=mix(gr,vec3(.13,.17,.08)*(.7+.6*n1),smoothstep(126.,190.,r)*.6);
float hB=t3.r*.6+t2.r*.4,gl=.06,bumpK=1.4;
// 城区铺装：3m 方砖 + 砖缝
vec2 tc=p/3.,tf=abs(fract(tc)-.5);float joint=smoothstep(.47-aa*.3,.5,max(tf.x,tf.y));
vec3 pv=vec3(.3,.31,.34)*(.82+.3*hash21(floor(tc)))*(.9+.2*t2.g)*(1.-.35*joint);
// 滑板公园：浅色混凝土 + 喷涂色块
vec3 sk=vec3(.4,.41,.44)*(.86+.2*n2);
float b1=texture2D(tNoise,p*.011+.3).r,b2=texture2D(tNoise,p*.013+.7).r;
sk=mix(sk,vec3(.95,.36,.45),smoothstep(.56,.57+aa*.05,b1)*.85);
sk=mix(sk,vec3(.2,.72,.58),smoothstep(.57,.58+aa*.05,b2)*.85);
sk=mix(sk,vec3(.25,.52,1.),ln(fract(length(p+vec2(42.,42.))/9.)-.5,.03,aa*.12)*.9);
// 货柜场：深色地面 + 黄色网格线
vec3 yd=vec3(.13,.135,.15)*(.8+.4*n3);
vec2 yc=abs(fract(p/9.)-.5)*9.;
yd=mix(yd,vec3(.85,.6,.06),ln(min(yc.x,yc.y),.09,aa)*.8*(.6+.4*t2.g));
vec3 base=mix(pv,gr,grassZ);base=mix(base,sk,skate);base=mix(base,yd,yard);
gl=mix(.3,gl,grassZ);bumpK=mix(.5,bumpK,grassZ);
hB=mix(hB-joint*.8,hB,grassZ);
// 人行道
vec3 sw=vec3(.36,.36,.38)*(.86+.2*hash21(floor(p/1.6)))*(.9+.2*t3.g);
sw*=1.-.3*ln(dR-6.8,.12,aa);
base=mix(base,sw,walk);gl=mix(gl,.25,walk);bumpK=mix(bumpK,.5,walk);
// 车道：沥青颗粒 + 裂缝（Voronoi 边）+ 蓝色自行车道 + 标线
float lat,lon;
if(dr<dc){lat=r-78.;lon=atan(p.y,p.x)*78.;}else if(dz<dx){lat=p.y;lon=p.x;}else{lat=p.x;lon=p.y;}
float al=abs(lat);
float crack=smoothstep(.05,0.,texture2D(tNoise,p*.045).b)*.6;
vec3 rd=vec3(.04,.042,.05)*(.7+.6*n3)*(.85+.3*t2.r)*(1.-crack);
float bk=smoothstep(3.-aa,3.+aa,al)*smoothstep(4.55+aa,4.55-aa,al);
rd=mix(rd,vec3(.05,.16,.46)*(.8+.4*n3),bk*.92);
float mk=ln(lat,.09,aa)*step(.45,fract(lon/6.))+ln(al-4.75,.07,aa)+ln(al-3.,.05,aa);
mk*=step(5.,max(dr,dc));
float zs=step(.5,fract(lat/1.1+.25))*step(dc,5.);
float zb=smoothstep(27.-aa,27.+aa,r)*smoothstep(30.5+aa,30.5-aa,r)*zs;
float zb2=ln(dr-7.3,1.5,aa)*zs*step(dc,dr);
mk=clamp(max(mk*(1.-step(r,30.5)),max(zb,zb2)),0.,1.)*(.75+.25*t3.r);
rd=mix(rd,vec3(.72),mk*.92);
base=mix(base,rd,road);gl=mix(gl,.42+.2*t1.g,road);bumpK=mix(bumpK,.35,road);hB=mix(hB,t3.a*.5+t3.r*.5,road);
// 中心广场：Voronoi 石板 + 品牌蓝环带
vec4 vo=texture2D(tNoise,p*.15);
float st=smoothstep(.0,.07,vo.b);
vec3 pl=mix(vec3(.36,.35,.34),vec3(.56,.54,.5),vo.g)*(.9+.15*n2)*(.5+.5*st);
pl=mix(pl,vec3(.3,.58,1.),ln(r-25.,.55,aa)+ln(r-13.,.3,aa));
pl=mix(pl,vec3(.55,.78,1.)*(.92+.1*t2.r),smoothstep(8.+aa,8.-aa,r));
pl=mix(pl,vec3(.92),ln(r-8.,.22,aa));
base=mix(base,pl,plz);gl=mix(gl,.55,plz);bumpK=mix(bumpK,.25,plz);hB=mix(hB,st*1.5+t3.r*.3,plz*step(8.,r));
float dG=gl;
vec3 dEm=vec3(.2,.5,1.)*(ln(r-25.,.18,aa)*plz+ln(r-124.6,.25,aa))*(.12+1.6*uNight);
// 噪声高度的有限差分作为凹凸法线
float e=.004;
vec2 buv=p*1.3;
float hx=texture2D(tNoise,buv+vec2(e,0.)).r-t3.r,hz=texture2D(tNoise,buv+vec2(0.,e)).r-t3.r;
vec3 dBump=vec3(-hx,0.,-hz)*bumpK*(1.-smoothstep(25.,70.,length(vWp-cameraPosition)))*6.;
float dMt=0.,dF=0.;
diffuseColor.rgb=base;
`;
export const F_BUMP = `normal=normalize(normal+(viewMatrix*vec4(dBump,0.)).xyz);`;

// ---------- 天空 ----------
export const VS_SKY = `
varying vec3 vD;
void main(){vD=position;vec4 p=projectionMatrix*vec4(mat3(viewMatrix)*position,1.);gl_Position=p.xyww;}
`;
export const FS_SKY = `
varying vec3 vD;
uniform vec3 uZen,uHor,uGlow,uSunD,uMoonD,uCl,uSunK;uniform float uTime,uNight,uEnv;
float hash21(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x),mix(hash21(i+vec2(0,1)),hash21(i+vec2(1)),f.x),f.y);}
float fbm(vec2 p){float a=.5,s=0.;for(int i=0;i<5;i++){s+=a*noise(p);p=p*2.03+17.3;a*=.5;}return s;}
vec3 hzc(vec3 d){vec3 e=normalize(vec3(d.x,0.,d.z)+1e-5);return uHor+uGlow*pow(max(dot(e,normalize(vec3(uSunD.x,0.,uSunD.z)+1e-5)),0.),5.);}
void main(){
  vec3 d=normalize(vD);float h=max(d.y,0.);
  vec3 c=mix(hzc(d),uZen,pow(h,.42));
  float s=max(dot(d,uSunD),0.),m=max(dot(d,uMoonD),0.);
  if(uEnv<.5){
    // 星空
    vec3 sd=d*170.,sf=floor(sd);float st=hash21(sf.xy+sf.z*57.3);
    c+=step(.992,st)*smoothstep(.45,.05,length(fract(sd)-.5))*uNight*smoothstep(.02,.3,d.y)*(1.5+sin(uTime*3.+st*900.))*1.5;
    // 日月
    c+=uSunK*(smoothstep(.9992,.9996,s)*40.+pow(s,90.)*.8);
    c+=vec3(.75,.85,1.)*uNight*(smoothstep(.9990,.9994,m)*6.+pow(m,300.)*.5);}
  c+=uSunK*pow(s,8.)*.15;
  // 云：两层 fbm 投影到天顶平面
  vec2 cp=d.xz/(h+.1)*.8+uTime*.004;
  float cl=fbm(cp*1.2)+.3*fbm(cp*3.7+uTime*.01);
  float ca=smoothstep(.6,.95,cl)*smoothstep(.01,.14,d.y);
  vec3 cc=uCl*(.7+.6*smoothstep(.6,1.15,cl))+uGlow*.5*pow(s,3.);
  c=mix(c,cc,ca*.9);
  c=mix(c,uHor*.5,smoothstep(0.,-.25,d.y));
  gl_FragColor=vec4(c,1.);}
`;

// ---------- 粒子：实例化公告板，形状由片元着色器计算 ----------
export const VS_P = `
attribute vec4 iP,iC,iR;varying vec2 vU;varying vec4 vC;varying float vS;
void main(){vec2 c=position.xy;vU=c;
  float s=sin(iR.x),k=cos(iR.x);vec2 r=vec2(c.x*k-c.y*s,c.x*s+c.y*k)*iP.w;
  vec3 cr=vec3(viewMatrix[0][0],viewMatrix[1][0],viewMatrix[2][0]),cu=vec3(viewMatrix[0][1],viewMatrix[1][1],viewMatrix[2][1]);
  vec3 w=iR.y>7.5?iP.xyz+vec3(r.x,0.,r.y):iP.xyz+cr*r.x+cu*r.y;
  vC=iC;vS=iR.y;gl_Position=projectionMatrix*viewMatrix*vec4(w,1.);}
`;
export const FS_P = `
varying vec2 vU;varying vec4 vC;varying float vS;
void main(){float d=length(vU),a;
  if(vS<.5)a=pow(max(1.-d,0.),2.);
  else if(vS<1.5)a=smoothstep(1.,.25,d);
  else if(vS<2.5)a=smoothstep(.14,0.,abs(d-.84));
  else if(vS<3.5)a=smoothstep(1.,.7,d);
  else if(vS<4.5){vec2 q=abs(vU);a=pow(max(1.-d,0.),2.)+max(0.,1.-q.x*14.)*max(1.-q.y,0.)+max(0.,1.-q.y*14.)*max(1.-q.x,0.);}
  else if(vS<8.5)a=smoothstep(.1,0.,abs(d-.88))+smoothstep(1.,.0,d)*.12*step(d,.88);
  else a=smoothstep(1.,.97,d)*(.35+.65*smoothstep(.12,0.,abs(d-.9)));
  gl_FragColor=vC*a;}
`;
// 弹道/光束：从 A 到 B 的朝向相机的条带
export const VS_TR = `
attribute vec4 iA,iB,iC;varying vec2 vU;varying vec4 vC;
void main(){float t=position.x,s=position.y;vec3 p=mix(iA.xyz,iB.xyz,t);
  vec3 d=normalize(cross(iB.xyz-iA.xyz,cameraPosition-p)+1e-6);p+=d*s*iA.w;vU=vec2(s,t);vC=iC;gl_Position=projectionMatrix*viewMatrix*vec4(p,1.);}
`;
export const FS_TR = `
varying vec2 vU;varying vec4 vC;
void main(){float a=pow(1.-abs(vU.x),1.6)*mix(vC.a,1.,vU.y);gl_FragColor=vec4(vC.rgb*a,0.);}
`;
// 能量护盾/传送门/边界墙：菲涅尔 + 扫描线，加色混合
export const VS_SHL = `
attribute vec4 iT;varying vec3 vWp,vN;varying vec4 vC,vT;
void main(){vec4 w=modelMatrix*instanceMatrix*vec4(position,1.);vWp=w.xyz;vN=normalize(mat3(modelMatrix)*mat3(instanceMatrix)*normal);vC=color;vT=iT;gl_Position=projectionMatrix*viewMatrix*w;}
`;
export const FS_SHL = `
varying vec3 vWp,vN;varying vec4 vC,vT;uniform float uTime;
void main(){vec3 v=normalize(cameraPosition-vWp);
  float f=pow(1.-abs(dot(normalize(vN),v)),1.5),s=.5+.5*sin(vWp.y*7.-uTime*4.),hx=step(.9,fract(vWp.y*.5-uTime*.2));
  gl_FragColor=vec4(pow(vC.rgb,vec3(2.2))*vT.rgb*(f*1.5+s*.12+hx*.5+.1)*vT.a*3.,0.);}
`;
// 招牌：采样运行时绘制的 Canvas 图集
export const VS_SG = `
varying vec3 vWp;varying vec2 vU;
void main(){vec4 w=modelMatrix*vec4(position,1.);vWp=w.xyz;vU=uv;gl_Position=projectionMatrix*viewMatrix*w;}
`;
export const FS_SG = `
varying vec3 vWp;varying vec2 vU;uniform sampler2D tMap;uniform float uK,uFogK;uniform vec3 uHor;
void main(){vec4 t=texture2D(tMap,vU);if(t.a<.5)discard;vec3 c=pow(t.rgb,vec3(2.2))*uK;
  gl_FragColor=vec4(mix(c,uHor,1.-exp(-pow(length(vWp-cameraPosition)*uFogK,1.5))),1.);}
`;

// ---------- 后处理链 ----------
export const VS_Q = `varying vec2 vU;void main(){vU=position.xy*.5+.5;gl_Position=vec4(position.xy,0.,1.);}`;
const DEPTH = `
uniform sampler2D tDepth;uniform vec2 uNF,uTan;
float lin(float d){return 2.*uNF.x*uNF.y/(uNF.y+uNF.x-(d*2.-1.)*(uNF.y-uNF.x));}
vec3 vpos(vec2 uv){float z=lin(texture2D(tDepth,uv).r);return vec3((uv*2.-1.)*uTan*z,-z);}
float ign(vec2 p){return fract(52.9829189*fract(dot(p,vec2(.06711056,.00583715))));}
`;
// 半分辨率：屏幕空间环境光遮蔽（R）+ 阴影贴图步进体积光（G）
export const FS_AOV = `
varying vec2 vU;` + DEPTH + `
uniform float uRadius,uSteps,uFrame;uniform mat4 uIV,uShM;uniform vec3 uCam,uSunD;uniform highp sampler2DShadow tSh;uniform float uVolOn;
void main(){
  float d0=texture2D(tDepth,vU).r;vec3 p=vpos(vU);float z=-p.z,ao=1.,vol=0.;
  float phi=ign(gl_FragCoord.xy+uFrame*5.3)*6.2831853;
  if(d0<1.){
    vec3 n=normalize(cross(dFdx(p),dFdy(p)));
    float rr=uRadius/(z*uTan.y),acc=0.;
    for(int i=0;i<10;i++){
      float fi=float(i),r=sqrt((fi+.5)/10.),th=fi*2.39996323+phi;
      vec3 s=vpos(vU+vec2(cos(th),sin(th))*r*rr*.5*vec2(uTan.y/uTan.x,1.)),v=s-p;
      float dd=dot(v,v);
      acc+=max(dot(v,n)-.03*z-.02,0.)/(dd+.02)*smoothstep(uRadius*uRadius*2.5,uRadius*uRadius*.6,dd);}
    ao=clamp(1.-acc*.34,0.,1.);}
  if(uVolOn>.5){
    vec3 w=(uIV*vec4(p,1.)).xyz,ray=w-uCam;float len=min(length(ray),110.);vec3 dir=ray/max(length(ray),1e-4);
    float j=ign(gl_FragCoord.xy+uFrame*3.7),acc=0.;
    for(float i=0.;i<uSteps;i++){
      vec3 q=uCam+dir*len*(i+j)/uSteps;vec4 sc=uShM*vec4(q,1.);
      float l=1.;
      if(sc.x>0.&&sc.x<1.&&sc.y>0.&&sc.y<1.&&sc.z<1.)l=texture(tSh,vec3(sc.xy,sc.z-.0015));
      acc+=l*exp(-max(q.y,0.)*.07);}
    float c=dot(dir,uSunD),g=.62;
    float ph=(1.-g*g)/pow(1.+g*g-2.*g*c,1.5)*.08;
    vol=acc/uSteps*len*.0075*(ph+.008);}
  gl_FragColor=vec4(ao,vol,0.,1.);}
`;
// 深度感知的双边模糊（分离式）
export const FS_BLUR = `
varying vec2 vU;` + DEPTH + `
uniform sampler2D tSrc;uniform vec2 uDir;
void main(){float z=lin(texture2D(tDepth,vU).r);vec2 s=vec2(0.);float ws=0.;
  for(int i=-3;i<=3;i++){vec2 u=vU+uDir*float(i);float zi=lin(texture2D(tDepth,u).r);
    float w=exp(-float(i*i)*.16)*exp(-abs(zi-z)/(.04*z+.05));s+=texture2D(tSrc,u).rg*w;ws+=w;}
  gl_FragColor=vec4(s/ws,0.,1.);}
`;
// 相机运动模糊：由深度重建世界坐标并用上一帧 VP 重投影得到速度
export const FS_MB = `
varying vec2 vU;uniform sampler2D tColor,tDepth;uniform mat4 uIVP,uPVP;uniform float uShutter,uNearZ;uniform vec2 uNF;
void main(){float d=texture2D(tDepth,vU).r;
  vec4 w=uIVP*vec4(vU*2.-1.,d*2.-1.,1.);w/=w.w;vec4 q=uPVP*w;vec2 pu=q.xy/q.w*.5+.5;
  float z=2.*uNF.x*uNF.y/(uNF.y+uNF.x-(d*2.-1.)*(uNF.y-uNF.x));
  vec2 v=(vU-pu)*uShutter*smoothstep(uNearZ,uNearZ+5.,z);float l=length(v);if(l>.03)v*=.03/l;
  if(q.w<=0.||l<.0006){gl_FragColor=texture2D(tColor,vU);return;}
  float j=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))));
  vec3 c=vec3(0.);for(int i=0;i<8;i++)c+=texture2D(tColor,vU-v*((float(i)+j)/8.-.5)).rgb;
  gl_FragColor=vec4(c/8.,1.);}
`;
// Bloom：双滤波降采样/升采样
export const FS_DN = `
varying vec2 vU;uniform sampler2D tSrc;uniform vec2 uPx;uniform float uThr;
void main(){vec3 c=texture2D(tSrc,vU).rgb*4.;
  c+=texture2D(tSrc,vU+uPx).rgb+texture2D(tSrc,vU-uPx).rgb+texture2D(tSrc,vU+vec2(uPx.x,-uPx.y)).rgb+texture2D(tSrc,vU-vec2(uPx.x,-uPx.y)).rgb;c*=.125;
  if(uThr>0.){c=min(c,vec3(30.));float l=max(c.r,max(c.g,c.b));c*=max(l-uThr,0.)/max(l,1e-4);}
  gl_FragColor=vec4(c,1.);}
`;
export const FS_UP = `
varying vec2 vU;uniform sampler2D tSrc;uniform vec2 uPx;
void main(){vec3 c=texture2D(tSrc,vU+vec2(uPx.x*2.,0.)).rgb+texture2D(tSrc,vU-vec2(uPx.x*2.,0.)).rgb+texture2D(tSrc,vU+vec2(0.,uPx.y*2.)).rgb+texture2D(tSrc,vU-vec2(0.,uPx.y*2.)).rgb;
  c+=(texture2D(tSrc,vU+uPx).rgb+texture2D(tSrc,vU-uPx).rgb+texture2D(tSrc,vU+vec2(uPx.x,-uPx.y)).rgb+texture2D(tSrc,vU-vec2(uPx.x,-uPx.y)).rgb)*2.;
  gl_FragColor=vec4(c/12.,1.);}
`;
// 自动曝光：对数亮度降采样 → 1x1 时间平滑
export const FS_LUM = `
varying vec2 vU;uniform sampler2D tSrc;
void main(){float s=0.;for(int i=0;i<4;i++)for(int j=0;j<4;j++){vec3 c=texture2D(tSrc,vU+(vec2(float(i),float(j))-1.5)/256.).rgb;s+=log(max(dot(c,vec3(.2126,.7152,.0722)),.002));}
  float w=1.-.5*smoothstep(.55,1.,vU.y);gl_FragColor=vec4(s/16.*w,w,0.,1.);}
`;
export const FS_ADAPT = `
varying vec2 vU;uniform sampler2D tSrc,tPrev;uniform float uK;
void main(){vec2 a=textureLod(tSrc,vec2(.5),8.).rg;float t=exp(a.r/max(a.g,1e-3)),p=texture2D(tPrev,vec2(.5)).r;
  gl_FragColor=vec4(mix(p,t,uK),0.,0.,1.);}
`;
// 合成：AO + 体积光 + Bloom + 镜头光晕 + 自动曝光 + ACES + 色差/暗角/受伤/子弹时间/速度线
export const FS_C = `
varying vec2 vU;uniform sampler2D tScene,tBloom,tAOV,tAdapt,tDepth;
uniform vec4 uFx;uniform vec4 uFx2;uniform vec3 uSunCol;uniform vec3 uSunUv;uniform float uTime,uAspect,uAoOn;
float hash21(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
void main(){vec2 c=vU-.5;float r2=dot(c,c);
  float ca=(uFx.x*.02+uFx.z*.006+.0012)*r2*4.;
  vec3 s=vec3(texture2D(tScene,vU+c*ca).r,texture2D(tScene,vU).g,texture2D(tScene,vU-c*ca).b);
  vec2 av=uAoOn>.5?texture2D(tAOV,vU).rg:vec2(1.,0.);
  s*=mix(1.,av.r,.85);
  s+=uSunCol*av.g;
  vec3 bl=texture2D(tBloom,vU).rgb;
  s+=bl*uFx2.x;
  // 镜头光晕：对泛光纹理做鬼影采样 + 光环，加上太阳可见时的星芒
  vec2 g=vec2(1.)-vU,gv=(vec2(.5)-g)*.38;vec3 fl=vec3(0.);
  for(int i=1;i<4;i++){vec2 u=g+gv*float(i);fl+=texture2D(tBloom,u).rgb*smoothstep(.6,.1,length(u-.5))*vec3(1.-.2*float(i),.8,.6+.2*float(i));}
  s+=fl*uFx2.z;
  if(uSunUv.z>.01){vec2 sv=(vU-uSunUv.xy)*vec2(uAspect,1.);float sd=length(sv),an=atan(sv.y,sv.x);
    float vis=step(1.,texture2D(tDepth,uSunUv.xy).r)*uSunUv.z;
    s+=uSunCol*vis*(.012/(sd*sd+.004)*(.6+.4*sin(an*6.+sd*4.)*sin(an*11.))*.35+.02/(abs(sv.y)*40.+.05)*smoothstep(.7,0.,abs(sv.x))*.3);}
  float ex=clamp(uFx2.w/max(texture2D(tAdapt,vec2(.5)).r,.02),.4,2.1)*uFx.w;
  s*=ex;
  float l=dot(s,vec3(.3,.6,.1));
  s=mix(s,vec3(l)*vec3(.55,.9,1.35),uFx.y*.65);
  s=mix(vec3(l),s,1.1);
  s=(s*(2.51*s+.03))/(s*(2.43*s+.59)+.14);
  s=pow(clamp(s,0.,1.),vec3(1./2.2));
  s*=1.-r2*.5;
  s=mix(s,vec3(.95,.08,.1),uFx.x*smoothstep(.08,.5,r2)*.75);
  s=mix(s,vec3(.3,.8,1.),uFx.y*smoothstep(.15,.6,r2)*.3);
  float an=atan(c.y,c.x);
  s+=step(.9,hash21(vec2(floor(an*50.),floor(uTime*24.))))*smoothstep(.1,.45,r2)*uFx.z*.2;
  s+=(hash21(vU*900.+fract(uTime)*37.)-.5)*.016;
  s=mix(s,vec3(0.),uFx2.y);
  gl_FragColor=vec4(s,dot(s,vec3(.299,.587,.114)));}
`;
// FXAA（亮度存放在 alpha 通道）
export const FS_FXAA = `
varying vec2 vU;uniform sampler2D tSrc;uniform vec2 uPx;
void main(){
  vec4 m=texture2D(tSrc,vU);
  float nw=texture2D(tSrc,vU+vec2(-1.,-1.)*uPx).a,ne=texture2D(tSrc,vU+vec2(1.,-1.)*uPx).a,sw=texture2D(tSrc,vU+vec2(-1.,1.)*uPx).a,se=texture2D(tSrc,vU+vec2(1.,1.)*uPx).a;
  float lmin=min(m.a,min(min(nw,ne),min(sw,se))),lmax=max(m.a,max(max(nw,ne),max(sw,se)));
  if(lmax-lmin<max(.04,lmax*.12)){gl_FragColor=vec4(m.rgb,1.);return;}
  vec2 d=vec2(-((nw+ne)-(sw+se)),(nw+sw)-(ne+se));
  float rd=1./(min(abs(d.x),abs(d.y))+max((nw+ne+sw+se)*.03125,.0078125));
  d=clamp(d*rd,-8.,8.)*uPx;
  vec3 a=.5*(texture2D(tSrc,vU+d*(1./3.-.5)).rgb+texture2D(tSrc,vU+d*(2./3.-.5)).rgb);
  vec4 b4=.5*(texture2D(tSrc,vU+d*-.5)+texture2D(tSrc,vU+d*.5));
  vec3 b=a*.5+b4.rgb*.5;float lb=a.r*.299+a.g*.587+a.b*.114;lb=lb*.5+b4.a*.5;
  gl_FragColor=vec4((lb<lmin||lb>lmax)?a:b,1.);}
`;

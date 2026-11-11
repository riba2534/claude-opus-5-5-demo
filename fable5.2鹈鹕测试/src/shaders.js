// 全部自写 GLSL：材质库烘焙、PBR 材质注入、建筑立面、地面、植被、天空、粒子、后处理链
// 纹理只有三类，全部运行时生成：GPU 烘焙的程序化材质数组、Canvas 2D 画的招牌/叶片图集、嵌入的官方豆包头像

// ---------- 程序化 PBR 材质库：在 GPU 上把每种材质烘焙进纹理数组的一层 ----------
// 通道 A = 反照率细节(rgb，0.5 为中性，使用时 ×2 乘到底色上) + 高度(a)；通道 B = 粗糙度、AO、金属度
export const FS_BAKE = `
varying vec2 vU;uniform int uL,uPass;
float h21(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
vec2 h22(vec2 p){return vec2(h21(p),h21(p+71.3));}
// 周期为 per 的值噪声 / fbm / Voronoi，保证贴图四方连续
float pn(vec2 p,float per){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(h21(mod(i,per)),h21(mod(i+vec2(1,0),per)),f.x),mix(h21(mod(i+vec2(0,1),per)),h21(mod(i+vec2(1),per)),f.x),f.y);}
float fb(vec2 u,float per){float a=.5,s=0.;for(int k=0;k<5;k++){s+=a*pn(u*per,per);per*=2.;a*=.5;}return s;}
vec3 vor(vec2 u,vec2 n){vec2 p=u*n,i=floor(p),f=fract(p);float a=9.,b=9.,id=0.;
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){vec2 g=vec2(x,y),c=mod(i+g,n);float d=length(g+h22(c)-f);if(d<a){b=a;a=d;id=h21(c+7.);}else if(d<b)b=d;}
  return vec3(a,b-a,id);}
vec3 vor(vec2 u,float n){return vor(u,vec2(n));}
// 网格砖缝：返回 (到缝的距离, 砖块随机值)
vec2 tile(vec2 p,float w){vec2 f=fract(p),e=min(f,1.-f);return vec2(min(e.x,e.y)/w,h21(floor(p)));}
void mat(int L,vec2 u,out vec3 c,out float h,out float r,out float ao,out float mt){
  c=vec3(.5);h=.5;r=.8;ao=1.;mt=0.;
  float n=fb(u,6.),n2=fb(u+.37,24.);
  if(L==1){ // 沥青：骨料颗粒
    vec3 v=vor(u,150.);float st=smoothstep(.5,.1,v.x);
    c=vec3(.42+.16*n)+st*(v.z-.45)*.3;h=.45+st*.2+n2*.15;r=.86+.1*v.z;ao=.82+.18*st;
  }else if(L==2){ // 混凝土：模板缝、气孔、水渍
    vec3 v=vor(u,46.);float pore=smoothstep(.08,.03,v.x)*step(.95,v.z);
    float seam=smoothstep(.012,.0,abs(fract(u.y*2.)-.5)-.492)+smoothstep(.01,0.,abs(fract(u.x*1.)-.5)-.494);
    c=vec3(.5+(n-.5)*.28+(n2-.5)*.1)*(1.-.5*pore)*(1.-.3*seam);h=.6-.4*pore-.25*seam+n2*.1;r=.72+.2*n;ao=1.-.4*pore-.25*seam;
  }else if(L==3){ // 红砖：错缝砌筑
    vec2 p=u*vec2(8.,24.);p.x+=.5*mod(floor(p.y),2.);vec2 f=fract(p),id=floor(p);id.x=mod(id.x,8.);
    float e=min(min(f.x,1.-f.x)/.045,min(f.y,1.-f.y)/.13),b=smoothstep(.6,1.2,e),k=h21(id),k2=h21(id+3.3);
    vec3 br=mix(vec3(.33,.13,.09),vec3(.42,.2,.13),k);br=mix(br,vec3(.24,.11,.09),step(.86,k2));br*=.85+.3*fb(u,48.);
    c=mix(vec3(.3,.29,.27),br,b);h=mix(.25,.75+.2*n2+.1*k,b);r=mix(.95,.82,b);ao=mix(.6,1.,smoothstep(.2,1.4,e));
  }else if(L==4){ // 外墙涂料：细颗粒 + 雨痕
    float g=fb(u,64.);c=vec3(.5+(n-.5)*.14+(g-.5)*.12);h=.5+(g-.5)*.5;r=.88;ao=.9+.1*g;
  }else if(L==5){ // 人行道面包砖
    // 20×10 cm 错缝铺砌，灰 / 暗红 / 土黄三色随机
    vec2 p=u*vec2(12.,24.);p.x+=.5*mod(floor(p.y),2.);vec2 f=fract(p),id=floor(p);id.x=mod(id.x,12.);
    float e=min(min(f.x,1.-f.x)/.03,min(f.y,1.-f.y)/.06),b=smoothstep(.3,1.,e),k=h21(id),k2=h21(id+5.1);
    vec3 bc=k2<.62?vec3(.5):k2<.84?vec3(.56,.45,.41):vec3(.56,.51,.41);
    c=bc*(.86+.28*k)*(.9+.2*n2);c=mix(vec3(.35),c,b);h=mix(.3,.7+.12*k+n2*.12,b);r=.86;ao=mix(.6,1.,b);
  }else if(L==6){ // 瓦楞钢板：竖向波纹 + 锈迹
    float w=abs(fract(u.x*12.)-.5)*2.;float rib=smoothstep(.2,.55,w);float rust=smoothstep(.55,.8,fb(u*vec2(1.,.35),10.)+.25*(1.-u.y)*0.);
    c=mix(vec3(.5)*(.92+.16*n2),vec3(.3,.15,.07),rust*.75);h=.3+.5*rib+n2*.06;r=mix(.42,.9,rust);ao=.7+.3*rib;mt=1.-rust;
  }else if(L==7){ // 金属面板：拼缝、铆钉、划痕
    vec2 t=tile(u*2.,.02);vec2 q=abs(fract(u*2.)-.5);float rv=smoothstep(.03,.015,length(q-.44));
    float sc=smoothstep(.75,.9,pn(u*vec2(140.,6.),64.));
    c=vec3(.5)*(.95+.1*n)*(1.-.5*smoothstep(1.,.2,t.x))+sc*.1;h=.5-.3*smoothstep(1.,.2,t.x)+rv*.4;r=.3+.25*n+sc*.2;ao=.7+.3*smoothstep(.2,1.,t.x);mt=1.;
  }else if(L==8){ // 木板：木纹
    float pl=floor(u.y*6.),k=h21(vec2(pl,3.));float g=pn(vec2(u.x*6.+k*9.,u.y*90.),6.)*.6+pn(vec2(u.x*24.,u.y*240.),24.)*.4;
    float gap=smoothstep(.03,.0,abs(fract(u.y*6.)-.5)-.47);
    c=mix(vec3(.4,.26,.15),vec3(.6,.42,.25),g)*(.8+.4*k)*(1.-.7*gap);h=.5+g*.2-gap*.4;r=.65+.2*g;ao=1.-.5*gap;
  }else if(L==9){ // 树皮：纵向裂纹
    vec3 v=vor(u,vec2(18.,3.));float rg=smoothstep(.0,.45,v.y);
    c=mix(vec3(.36,.31,.27),vec3(.5,.45,.4),rg)*(.85+.3*n2);h=rg*.8+n2*.2;r=.95;ao=.75+.25*rg;
  }else if(L==10){ // 屋面：防水卷材 + 碎石
    vec3 v=vor(u,90.);c=vec3(.38+.25*v.z)*(.85+.3*n);h=.3+.5*smoothstep(.5,.1,v.x);r=.95;ao=.8+.2*v.z;
  }else if(L==11){ // 花岗岩石板
    vec2 t=tile(u*6.,.02);float b=smoothstep(.3,1.,t.x);vec3 v=vor(u,120.);
    c=vec3(.5)*(.78+.42*t.y)+(v.z-.5)*.12*smoothstep(.4,.1,v.x);c=mix(vec3(.3,.29,.27),c,b);
    h=mix(.3,.72,b)+(v.z-.5)*.03;r=mix(.92,.64+.2*n,b);ao=mix(.6,1.,b);
  }else if(L==12){ // 外墙小瓷砖
    vec2 t=tile(u*vec2(8.,16.),.06);float b=smoothstep(.3,1.,t.x);
    c=vec3(.5)*(.93+.12*t.y)*(1.-.25*step(.94,t.y));c=mix(vec3(.3),c,b);h=mix(.3,.7+.05*t.y,b);r=mix(.9,.16+.1*n,b);ao=mix(.6,1.,b);
  }else if(L==13){ // 草皮下的土壤
    c=mix(vec3(.3,.34,.14),vec3(.42,.5,.2),n)*(.8+.4*n2);h=n2;r=1.;ao=.8+.2*n2;
  }
}
void main(){vec3 c;float h,r,ao,mt;mat(uL,vU,c,h,r,ao,mt);
  gl_FragColor=uPass==0?vec4(c,h):vec4(r,ao,mt,1.);}
`;

// ---------- 注入 three 标准 PBR 材质的公共片元段 ----------
export const PARS = `
varying vec3 vWp;
uniform float uTime,uNight,uFogK;uniform sampler2D tNoise;uniform vec3 uHor,uGlow,uSunD;
uniform highp sampler2DArray tMatA,tMatB;
const float MSC[14]=float[14](1.,2.,4.,1.92,3.,2.4,2.4,2.4,2.,1.5,3.,3.6,1.2,2.);
float hash21(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
vec2 dBH=vec2(0.);
// 采样一层材质（t 为平铺坐标）：返回反照率系数，输出 粗糙度/AO/金属度，并用屏幕空间差分累计凹凸
vec3 matS(float L,vec2 t,float bump,out vec3 ram){
  vec3 q=vec3(t,L);vec4 a=texture(tMatA,q);ram=texture(tMatB,q).rgb;
  dBH+=vec2(texture(tMatA,q+vec3(dFdx(t),0.)).a-a.a,texture(tMatA,q+vec3(dFdy(t),0.)).a-a.a)*bump;
  return a.rgb*2.;}
// 盒式投影：地面用 xz，墙面用"沿墙方向 + 高度"
vec2 boxUV(vec3 p,vec3 n){if(abs(n.y)>.7)return p.xz;vec2 t=normalize(vec2(n.z,-n.x)+1e-5);return vec2(dot(p.xz,t),p.y);}
// 不足一个像素宽的细长三角形上屏幕空间导数会退化，直接归一化会得到 NaN 法线（画面上的黑点），所以先检查再用
vec3 bumpN(vec3 sp,vec3 sn,vec2 dH,float fd){
  vec3 dx=dFdx(sp),dy=dFdy(sp);float lx=dot(dx,dx),ly=dot(dy,dy);
  if(!(lx>1e-24&&ly>1e-24&&lx<1e12&&ly<1e12))return sn;
  vec3 sx=dx*inversesqrt(lx),sy=dy*inversesqrt(ly),r1=cross(sy,sn),r2=cross(sn,sx);float det=dot(sx,r1)*fd;
  vec3 r=abs(det)*sn-sign(det)*(dH.x*r1+dH.y*r2);float lr=dot(r,r);
  return lr>1e-24&&lr<1e12?r*inversesqrt(lr):sn;}
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
// 顶点注入：材质参数、每实例颜色/特效、植被摆动、世界坐标与贴图坐标
export const V_PARS = `
attribute vec4 aM,aT;
#ifdef USE_INSTANCING
attribute vec4 iT;
#endif
varying vec4 vM,vT,vX;varying vec3 vWp,vTp,vTn;uniform float uTime;
`;
export const V_BEGIN = `
transformed.xz+=aM.z*vec2(sin(uTime*1.6+position.x*.3+position.z*.2),cos(uTime*1.3+position.z*.3))*.25;
`;
export const V_END = `
vM=aM;vX=aT;
#ifdef USE_INSTANCING
vT=iT;vWp=(modelMatrix*instanceMatrix*vec4(transformed,1.)).xyz;vTp=position;
#else
vT=vec4(1.,1.,1.,0.);vWp=(modelMatrix*vec4(transformed,1.)).xyz;vTp=vWp;
#endif
vTn=normal;
`;
// 物体材质：顶点色底色 × 材质层细节 + 自发光 + 数字溶解
export const F_OBJ = `
vec3 dA=pow(vColor.rgb,vec3(2.2))*vT.rgb;
float dG=vM.x,dMt=step(.25,vM.y)*step(vM.y,.75),dF=max(vT.a,0.),dAO=1.;
vec3 dEm=dA*vColor.a*mix(1.,uNight,vM.w)*5.5;
if(vT.a<0.){
  // 数字溶解：按世界空间小方块逐块消失，边缘发青光（敌人生成/死亡）
  float k=hash21(floor(vWp.xy*10.)+floor(vWp.z*10.)*7.31);
  if(k<-vT.a)discard;
  if(k<.12-vT.a)dEm+=vec3(.3,2.,4.);}
vec3 tN=normalize(vTn);float L=floor(vX.x*255.+.5);
if(L>.5){
  // 材质层：aT.y>0 时用绕 Y 轴的柱面投影（树干、立柱），否则盒式投影
  vec2 t=vX.y>.5?vec2(atan(tN.x,tN.z)*.31831,vTp.y/MSC[int(L)]):boxUV(vTp,tN)/MSC[int(L)];
  vec3 ram;dA*=matS(L,t,2.+vX.z*40.,ram);dG=1.-ram.r;dAO=ram.g;dMt=ram.b;
}else{
  vec3 nz=texture2D(tNoise,(abs(tN.y)>.6?vTp.xz:(abs(tN.x)>.6?vTp.zy:vTp.xy))*.31).rgb;
  dA*=.9+.2*nz.r;dG*=.82+.36*nz.g;}
diffuseColor.rgb*=dA*mix(1.,dAO,.75);
`;
export const F_ROUGH = `float roughnessFactor=clamp(1.-dG*.94,.05,1.);`;
export const F_METAL = `float metalnessFactor=dMt;`;
export const F_EMIS = `totalEmissiveRadiance+=dEm;`;
export const F_NRM = `normal=bumpN(-vViewPosition,normal,dBH*(1.-smoothstep(20.,65.,length(vViewPosition))),faceDirection);`;
export const F_LAMP = `reflectedLight.directDiffuse+=material.diffuseColor*vec3(1.,.7,.4)*lamps(vWp.xz)*.55*smoothstep(7.5,3.,vWp.y);`;
export const F_OUT = `
// 太阳在光滑表面上的镜面高光可能超出半浮点范围变成 Inf，经过色调映射会成黑点，先钳住
gl_FragColor.rgb=mix(min(gl_FragColor.rgb,vec3(48.)),vec3(4.),dF);
{vec3 fd=vWp-cameraPosition;gl_FragColor.rgb=mix(gl_FragColor.rgb,hzc(fd),1.-exp(-pow(length(fd)*uFogK,1.5)));}
`;

// ---------- 建筑立面：墙体材质 + 窗框窗台 + 室内视差（interior mapping）+ 窗帘百叶 + 雨水污渍 ----------
// uv = (沿墙米数, 离地米数)；aB = (墙面宽度, 立面样式, 随机种子, 墙体材质层)
// 样式：1 住宅（砖/瓷砖墙 + 独立窗）2 写字楼（横向带窗）3 玻璃幕墙 4 商业
export const V_FAC_PARS = `attribute vec4 aB;varying vec4 vB;varying vec2 vFu;varying vec3 vWp,vTn;`;
export const V_FAC_END = `vB=aB;vFu=uv;vWp=(modelMatrix*vec4(transformed,1.)).xyz;vTn=normal;`;
export const F_FAC = `
vec3 tN=normalize(vTn);
vec3 dA=pow(vColor.rgb,vec3(2.2));float dG=.2,dMt=0.,dF=0.,dAO=1.;vec3 dEm=vec3(0.),ram;
float L=floor(vB.w+.5),st=floor(vB.y+.5),seed=floor(vB.z+.5);
if(st<.5||abs(tN.y)>.5){
  dA*=matS(L,(abs(tN.y)>.5?vWp.xz:vFu)/MSC[int(L)],10.,ram);dG=1.-ram.r;dAO=ram.g;dMt=ram.b;
}else{
  float fw=vB.x,u=vFu.x,v=vFu.y;
  float W=st<1.5?3.3:st<2.5?2.9:st<3.5?1.75:3.6,FH=st<1.5?3.1:st<2.5?3.7:st<3.5?3.9:3.5,G0=st<2.5?4.2:5.;
  float nb=max(1.,floor(fw/W+.01)),uu=(u-(fw-nb*W)*.5)/W,inx=step(0.,uu)*step(uu,nb),gnd=step(v,G0);
  float vv=gnd>.5?v/G0:(v-G0)/FH,ch=gnd>.5?G0:FH;
  vec2 cell=vec2(floor(uu),gnd>.5?-1.:floor(vv)),f=vec2(fract(uu),gnd>.5?vv:fract(vv));
  float h1=hash21(cell+seed*13.1+3.),h2=hash21(cell+seed*7.7+9.),rid=hash21(cell+seed*91.7);
  // 窗洞 (x0,x1,y0,y1)
  vec4 wr=gnd>.5?vec4(.06,.94,.05,.7):st<1.5?vec4(.2,.8,.3,.82):st<2.5?vec4(.04,.96,.3,.84):st<3.5?vec4(.025,.975,.0,1.):vec4(.1,.9,.22,.86);
  float ax=fwidth(uu)*.8+1e-4,ay=fwidth(v)/ch*.8+1e-4,far=smoothstep(.5,.15,max(ax,ay));
  float win=inx*smoothstep(wr.x-ax,wr.x+ax,f.x)*smoothstep(wr.y+ax,wr.y-ax,f.x)*smoothstep(wr.z-ay,wr.z+ay,f.y)*smoothstep(wr.w+ay,wr.w-ay,f.y);
  vec2 fb=vec2(.07/W,.07/ch);
  float glass=inx*smoothstep(wr.x+fb.x-ax,wr.x+fb.x+ax,f.x)*smoothstep(wr.y-fb.x+ax,wr.y-fb.x-ax,f.x)*smoothstep(wr.z+fb.y-ay,wr.z+fb.y+ay,f.y)*smoothstep(wr.w-fb.y+ay,wr.w-fb.y-ay,f.y);
  vec2 f2=(f-wr.xz)/(wr.yw-wr.xz);
  // 窗棂：住宅竖向中梃 + 上亮窗，幕墙横梁
  float mul=st<1.5&&gnd<.5?max(smoothstep(.035,.02,abs(f2.x-.5)*W*.6),smoothstep(.03,.015,abs(f2.y-.72)*ch*.52)):st>2.5&&st<3.5?smoothstep(.03,.015,abs(f.y-.2)*ch):gnd>.5?smoothstep(.03,.015,abs(f2.y-.8)*ch*.65):0.;
  glass*=1.-mul*far;
  // 墙体
  dA*=matS(L,vFu/MSC[int(L)],L>3.5&&L<4.5?4.:8.,ram);dG=1.-ram.r;dAO=ram.g;dMt=ram.b;
  float g1=texture2D(tNoise,vec2(u*.11+seed,v*.006)).r,g2=texture2D(tNoise,vec2(u*.9,v*.02+seed)).a;
  float under=inx*smoothstep(.0,.12,wr.z-f.y)*smoothstep(.6,.0,wr.z-f.y)*step(wr.x,f.x)*step(f.x,wr.y);
  dA*=1.-.34*smoothstep(.4,.8,g1)*(.4+.6*g2)-.2*under*g2;
  dA*=mix(1.,.72,smoothstep(1.2,.0,v)*.8);
  // 楼层线与窗台
  float slab=(st<2.5?1.:0.)*(1.-gnd)*smoothstep(.05,.02,f.y*ch)+gnd*smoothstep(.06,.02,(1.-f.y)*ch);
  dA=mix(dA,vec3(.5,.49,.47)*(.8+.3*g2),slab*.9);dAO*=1.-.3*smoothstep(.2,.05,f.y*ch)*(1.-slab);
  float sill=inx*(st<1.5?1.:0.)*(1.-gnd)*step(wr.x-.03,f.x)*step(f.x,wr.y+.03)*smoothstep(.09,.05,(wr.z-f.y)*ch)*step(f.y,wr.z);
  dA=mix(dA,vec3(.62,.6,.56),sill);
  vec3 frc=st<1.5?vec3(.78,.78,.76):st<2.5?vec3(.1,.11,.12):st<3.5?vec3(.16,.17,.19):vec3(.05);
  dA=mix(dA,frc,(win-glass)*far);dG=mix(dG,.55,(win-glass)*far);dMt=mix(dMt,st>1.5?.8:0.,(win-glass)*far);
  if(glass>.003){
    // 室内视差：把视线变换到墙面切线空间，与一个虚拟房间盒求交
    vec3 V=normalize(vWp-cameraPosition),T=vec3(tN.z,0.,-tN.x);
    vec3 d=vec3(dot(V,T),V.y,min(dot(V,tN),-.02));
    float D=gnd>.5?7.:st>2.5?6.:4.2;vec3 p0=vec3(f.x*W,f.y*ch,0.);
    d.x=abs(d.x)<1e-4?1e-4:d.x;d.y=abs(d.y)<1e-4?1e-4:d.y;
    vec3 tt=vec3((d.x>0.?W-p0.x:-p0.x)/d.x,(d.y>0.?ch-p0.y:-p0.y)/d.y,-D/d.z);
    float t=min(tt.x,min(tt.y,tt.z));vec3 hp=p0+d*t;
    // 亮灯：住宅约三成，写字楼和幕墙按楼层成片亮，底商多数亮着；每扇窗的亮度和色温都不一样
    float flr=hash21(vec2(cell.y,seed*3.7)),thr=gnd>.5?.42:st>1.5&&st<3.5?(flr>.55?.3:.94):.68;
    float lit=step(thr,rid)*uNight*(.3+.7*h1);
    vec3 lc=h2<.55?vec3(1.,.74,.46):h2<.85?vec3(1.,.9,.76):vec3(.78,.88,1.);
    vec3 wc=mix(vec3(.82,.76,.66),vec3(.6,.72,.76),step(.62,h1));wc=mix(wc,vec3(.86,.85,.82),step(.8,h2));
    vec3 rc;
    if(t>=tt.z-1e-4){vec2 b=hp.xy/vec2(W,ch);rc=wc*(.65+.35*b.y);
      if(gnd>.5){float sh=step(.12,fract(b.y*4.))*step(b.y,.8);rc=mix(rc,vec3(h1,h2,.5)*.5+.25*hash21(floor(vec2(b.x*14.,b.y*4.))+seed),sh*.85);}
      else{rc=mix(rc,vec3(.22,.16,.12)+.2*h2,step(b.y,.3+.14*h2)*step(abs(b.x-.3-.4*h1),.24));rc=mix(rc,vec3(h1,.45,h2)*.7,step(abs(b.x-.72+.4*h1),.1)*step(abs(b.y-.62),.11));}
    }else if(t>=tt.y-1e-4){
      if(d.y>0.){vec2 q=vec2(hp.x/W-.5,hp.z/D+.5);rc=vec3(.8)+lit*2.5*smoothstep(.2,.06,length(q*vec2(1.,st>1.5?.3:1.)));}
      else rc=vec3(.36,.27,.2)*(.75+.25*step(.5,fract(hp.x*2.5)));
    }else rc=wc*.72;
    rc*=exp(-t*.07);
    vec3 room=rc*(lit*lc*(gnd>.5?.9:1.25)+(1.-uNight)*.09+.012);
    // 窗帘 / 百叶
    float cv=.1+.34*h1,cur=step(.42,h2)*(1.-gnd)*(st<2.5?1.:0.)*(step(f2.x,cv)+step(1.-cv,f2.x));
    vec3 cc=mix(vec3(.82,.78,.7),vec3(.5,.3,.32),step(.7,h1))*(1.-.2*far+.2*far*sin(f2.x*W*13.));
    room=mix(room,cc*(lit*lc*.9+(1.-uNight)*.22+.02),clamp(cur,0.,1.));
    float bl=step(h2,.2)*(1.-gnd)*step(1.-(.3+.5*h1),f2.y);
    room=mix(room,vec3(.75,.75,.72)*mix(.82,.6+.4*step(.35,fract(f2.y*ch*4.)),far)*(lit*.8+(1.-uNight)*.22+.02),bl);
    float tw=st>2.5&&st<3.5?1.:0.,sp=tw*step(f.y,.2);
    room=mix(room,vec3(.01),sp);
    // 窗洞进深：上沿和两侧留一条暗带；普通窗玻璃带一层冷灰色的天空反射
    float rec=1.-.6*max(smoothstep(.13,0.,(1.-f2.y)*(wr.w-wr.z)*ch),smoothstep(.1,0.,min(f2.x,1.-f2.x)*(wr.y-wr.x)*W))*far;
    dEm+=room*rec*glass*mix(1.,.3,tw)*mix(.25,1.,far);
    dA=mix(dA,mix(vec3(.1,.13,.16),vec3(.28,.4,.5),tw)*rec,glass);dG=mix(dG,mix(.9,.84,tw),glass);dMt=mix(dMt,mix(.55,.9,tw),glass);dAO=mix(dAO,1.,glass);dBH*=1.-glass;
  }
}
diffuseColor.rgb*=dA*mix(1.,dAO,.75);
`;

// ---------- 地面：材质层 + 道路标线磨损、自行车道、斑马线、井盖、积水、广场石板、草地 ----------
export const F_GROUND_PARS = `
float ln(float d,float w,float a){return smoothstep(w+a,w-a,abs(d));}
`;
export const F_GROUND = `
vec2 p=vWp.xz;float r=length(p),aa=length(fwidth(p))*.75+.002;
float dx=abs(p.x),dz=abs(p.y),dr=abs(r-78.),dc=min(dx,dz),dR=min(dc,dr);
float inA=smoothstep(125.+aa,125.-aa,r);
float road=smoothstep(5.+aa,5.-aa,dR)*inA,plz=smoothstep(26.+aa,26.-aa,r);
vec4 t1=texture2D(tNoise,p*.021),t2=texture2D(tNoise,p*.19),t3=texture2D(tNoise,p*1.3);
float n1=t1.r,n2=t2.r,n3=t3.a;
float sx=step(0.,p.x),sz=step(0.,p.y),inner=step(r,78.);
float grassZ=mix(1.,inner>.5?(1.-sx)*sz:abs(sx+sz-1.)<.5?0.:1.,step(r,125.))*(1.-plz)*(1.-road);
float skate=inner*(1.-sx)*(1.-sz)*(1.-plz)*(1.-road),yard=inner*sx*(1.-sz)*(1.-plz)*(1.-road);
// 每个片元只采样一种材质层：沥青 / 石板 / 混凝土 / 土壤 / 面包砖
float urb=(1.-road)*(1.-plz)*(1.-skate)*(1.-yard)*(1.-grassZ);
float L=road>.5?1.:plz>.5?11.:skate+yard>.5?2.:grassZ>.5?13.:dR<9.6?5.:2.;
vec3 ram,base=matS(L,p/MSC[int(L)],L<1.5?5.:L>12.?5.:8.,ram);
float gl=1.-ram.r,dAO=ram.g;
if(L<1.5){
  // 车道：补丁、裂缝、蓝色自行车道、磨损的标线
  float lat,lon;
  if(dr<dc){lat=r-78.;lon=atan(p.y,p.x)*78.;}else if(dz<dx){lat=p.y;lon=p.x;}else{lat=p.x;lon=p.y;}
  float al=abs(lat);
  float ptc=step(.8,hash21(floor(vec2(lon/7.,lat/2.6+9.))))*.3;
  float crack=smoothstep(.045,0.,texture2D(tNoise,p*.045).b);
  base*=vec3(.19,.195,.21)*(1.-ptc)*(1.-.5*crack)*(.8+.4*n1);
  float bk=smoothstep(3.-aa,3.+aa,al)*smoothstep(4.55+aa,4.55-aa,al);
  base=mix(base,vec3(.03,.085,.2)*(.6+.8*n3)*(1.-.4*crack),bk*.85*smoothstep(.12,.5,t2.g*.5+t3.r*.7));
  float wear=smoothstep(.2,.55,t2.g*.6+t3.r*.6);
  float mk=ln(lat,.09,aa)*step(.45,fract(lon/6.))+ln(al-4.75,.07,aa)+ln(al-3.,.05,aa);
  mk*=step(5.,max(dr,dc));
  float zs=step(.5,fract(lat/1.1+.25))*step(dc,5.);
  float zb=smoothstep(27.-aa,27.+aa,r)*smoothstep(30.5+aa,30.5-aa,r)*zs,zb2=ln(dr-7.3,1.5,aa)*zs*step(dc,dr);
  mk=clamp(max(mk*(1.-step(r,30.5)),max(zb,zb2)),0.,1.)*wear;
  base=mix(base,vec3(.62,.62,.6)*(.8+.3*t3.r),mk*.9);gl=mix(gl,.3,mk);
  // 井盖：沿道路每 26 米一个
  vec2 mh=vec2(mod(lon,26.)-13.,al-1.6);float md=length(mh);
  float mm=smoothstep(.42+aa,.42-aa,md)*step(5.,max(dr,dc));
  float mp=.5+.5*sin(md*60.)*step(md,.36)+.3*step(.5,fract(atan(mh.y,mh.x)*2.5));
  base=mix(base,vec3(.07,.065,.06)*(.7+.6*mp),mm);gl=mix(gl,.55,mm);dBH*=1.-mm;
  // 积水：低洼处变成镜面
  // 积水：集中在路缘的低洼处，外圈一圈只变暗的湿痕
  float pw=t1.r*.55+n2*.3+smoothstep(2.8,4.8,al)*.15,pud=smoothstep(.6,.65,pw)*(1.-mk)*(1.-mm),wet=smoothstep(.52,.6,pw);
  base*=1.-.25*wet-.25*pud;gl=mix(mix(gl,.62,wet*.6),.985,pud);dBH*=1.-pud;
}else if(L>12.){
  // 草地：多尺度色彩变化 + 修剪条纹
  base*=mix(vec3(.06,.14,.035),vec3(.15,.25,.065),n1)*(.7+.6*n2)*1.5;
  base*=1.+.08*sin((p.x+p.y)*1.1)*step(r,125.);
  base=mix(base,vec3(.085,.1,.07)*(.7+.6*n1),smoothstep(126.,170.,r)*.75);gl=.05;
}else if(L>10.){
  // 广场：品牌蓝环带与中心圆盘
  base*=vec3(.5,.49,.47)*(.85+.3*n2);
  base=mix(base,vec3(.2,.42,.85)*(.8+.4*t3.r),ln(r-25.,.55,aa)+ln(r-13.,.3,aa));
  base=mix(base,vec3(.42,.62,.86)*(.85+.3*t3.r),smoothstep(8.+aa,8.-aa,r));
  base=mix(base,vec3(.8),ln(r-8.,.22,aa));
  float pud=smoothstep(.62,.67,t1.r*.55+n2*.35);base*=1.-.3*pud;gl=mix(gl,.97,pud);dBH*=1.-pud;
}else if(L>4.){
  base*=vec3(.62,.61,.59)*(.85+.3*n1);
}else{
  // 滑板公园 / 货柜场混凝土：喷涂色块、黄色网格线、油渍
  base*=mix(mix(vec3(.46,.46,.47),vec3(.24,.24,.26),yard),vec3(.4,.4,.41),urb)*(.85+.3*n1);
  float b1=texture2D(tNoise,p*.011+.3).r,b2=texture2D(tNoise,p*.013+.7).r;
  base=mix(base,vec3(.8,.22,.3)*(.7+.5*t3.r),skate*smoothstep(.62,.63+aa*.05,b1)*.3);
  base=mix(base,vec3(.12,.55,.42)*(.7+.5*t3.r),skate*smoothstep(.63,.64+aa*.05,b2)*.3);
  vec2 yc=abs(fract(p/9.)-.5)*9.;
  base=mix(base,vec3(.75,.5,.04),yard*ln(min(yc.x,yc.y),.09,aa)*.8*smoothstep(.2,.5,t2.g));
  float oil=yard*smoothstep(.7,.8,t1.b*.4+n2*.7);base*=1.-.6*oil;gl=mix(gl,.9,oil);
}
float dG=gl;
vec3 dEm=vec3(.2,.5,1.)*(ln(r-25.,.18,aa)*plz+ln(r-124.6,.25,aa))*(.12+1.6*uNight);
float dMt=0.,dF=0.;
dBH*=1.-smoothstep(14.,48.,length(vWp-cameraPosition));
diffuseColor.rgb=base*mix(1.,dAO,.8);
`;

// ---------- 植被：透明测试的枝叶卡片（带逆光透射）与随相机循环铺设的草丛 ----------
export const V_FOL_PARS = `attribute float aSw;varying vec3 vWp;uniform float uTime;`;
export const V_FOL_BEGIN = `
transformed+=aSw*vec3(sin(uTime*1.5+position.x*.4+position.z*.3),sin(uTime*2.3+position.x)*.3,cos(uTime*1.2+position.z*.4))*.16;
`;
export const F_FOL_PARS = `varying vec3 vWp;uniform float uFogK,uNight;uniform vec3 uHor,uGlow,uSunD;
vec3 hzc(vec3 d){vec3 e=normalize(vec3(d.x,0.,d.z)+1e-5);return uHor+uGlow*pow(max(dot(e,normalize(vec3(uSunD.x,0.,uSunD.z)+1e-5)),0.),5.);}`;
// 叶片很薄：背光时让阳光透过来
export const F_FOL_LIGHT = `
#if NUM_DIR_LIGHTS>0
reflectedLight.directDiffuse+=material.diffuseColor*directionalLights[0].color*pow(max(dot(normalize(vWp-cameraPosition),directionalLights[0].direction*mat3(viewMatrix)),0.),3.)*.35;
#endif
`;
export const F_FOG = `{vec3 fd=vWp-cameraPosition;gl_FragColor.rgb=mix(gl_FragColor.rgb,hzc(fd),1.-exp(-pow(length(fd)*uFogK,1.5)));}`;
export const V_GRASS_PARS = `
attribute vec4 iO;uniform vec3 uCamP,uPlP;uniform sampler2D tHF;uniform float uTime,uGS;varying vec3 vWp;varying float vGk;
float gz(vec2 p){float r=length(p),sx=step(0.,p.x),sz=step(0.,p.y),dR=min(min(abs(p.x),abs(p.y)),abs(r-78.));
  float z=r<78.?(1.-sx)*sz:abs(sx+sz-1.)<.5?0.:1.;return z*step(7.4,dR)*step(27.,r)*step(r,123.);}
`;
export const V_GRASS = `
vec2 gw=uCamP.xz+mod(iO.xy-uCamP.xz,uGS)-uGS*.5;
float gh=texture2D(tHF,(gw+256.)/512.).r,gd=distance(gw,uCamP.xz);
float gs=(.65+iO.z*.8)*gz(gw)*smoothstep(uGS*.5,uGS*.36,gd);
float ga=iO.w*6.2831853,gc=cos(ga),gn=sin(ga);
vec3 gp=vec3(position.x*gc-position.z*gn,position.y,position.x*gn+position.z*gc)*gs;
// 风：顶部摆动；玩家经过时被压弯
vec2 away=gw-uPlP.xz;float pd=length(away);
vec2 bend=vec2(sin(uTime*1.7+gw.x*.35+gw.y*.2),cos(uTime*1.3+gw.y*.3))*.14+away/(pd+.01)*smoothstep(1.3,.2,pd)*.5;
gp.xz+=bend*position.y*position.y*gs*2.2;
vec3 transformed=vec3(gw.x,gh,gw.y)+gp;vGk=iO.z;
`;
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
    c+=step(.9965,st)*smoothstep(.45,.05,length(fract(sd)-.5))*uNight*smoothstep(.02,.3,d.y)*(1.5+sin(uTime*3.+st*900.))*1.5;
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
varying vec3 vWp;varying vec2 vU;uniform sampler2D tMap;uniform float uK,uFogK,uNight;uniform vec3 uHor,uSunD;
void main(){vec4 t=texture2D(tMap,vU);if(t.a<.5)discard;
  // 白天按朝向受光（法线由屏幕空间导数求出并朝向相机），夜里是自己发光的灯箱
  vec3 n=normalize(cross(dFdx(vWp),dFdy(vWp)));n*=sign(dot(n,cameraPosition-vWp));
  vec3 c=pow(t.rgb,vec3(2.2))*uK*mix(.42+.85*max(dot(n,uSunD),0.),.8,uNight);
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
varying vec2 vU;uniform sampler2D tScene,tBloom,tAOV,tAdapt,tDepth,tFace;
uniform vec4 uFx;uniform vec4 uFx2;uniform vec4 uPip;uniform vec3 uSunCol;uniform vec3 uSunUv;uniform float uTime,uAspect,uAoOn,uExMax;
float hash21(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
void main(){vec2 c=vU-.5;float r2=dot(c,c);
  float ca=(uFx.x*.02+uFx.z*.006+.0003)*r2*4.;
  vec3 s=vec3(texture2D(tScene,vU+c*ca).r,texture2D(tScene,vU).g,texture2D(tScene,vU-c*ca).b);
  s=min(s,vec3(48.));
  vec2 av=uAoOn>.5?texture2D(tAOV,vU).rg:vec2(1.,0.);
  s*=mix(1.,av.r,.85);
  s+=uSunCol*av.g;
  vec3 bl=texture2D(tBloom,vU).rgb;
  s+=bl*uFx2.x;
  // 镜头光晕：对泛光纹理做鬼影采样 + 光环，加上太阳可见时的星芒
  vec2 g=vec2(1.)-vU,gv=(vec2(.5)-g)*.38;vec3 fl=vec3(0.);
  for(int i=1;i<4;i++){vec2 u=g+gv*float(i);fl+=texture2D(tBloom,u).rgb*smoothstep(.6,.1,length(u-.5))*vec3(1.-.2*float(i),.8,.6+.2*float(i));}
  s+=fl*uFx2.z;
  // 画中画：豆包的正面实时镜头
  vec2 pp=(gl_FragCoord.xy-uPip.xy)/max(uPip.z,1.);float pd=length(pp),pip=uPip.w*step(pd,1.);
  if(pip>.5)s=texture2D(tFace,pp*.5+.5).rgb;
  if(uSunUv.z>.01){vec2 sv=(vU-uSunUv.xy)*vec2(uAspect,1.);float sd=length(sv),an=atan(sv.y,sv.x);
    float vis=step(1.,texture2D(tDepth,uSunUv.xy).r)*uSunUv.z;
    s+=uSunCol*vis*(.012/(sd*sd+.004)*(.6+.4*sin(an*6.+sd*4.)*sin(an*11.))*.35+.02/(abs(sv.y)*40.+.05)*smoothstep(.7,0.,abs(sv.x))*.3);}
  float ex=clamp(uFx2.w/max(texture2D(tAdapt,vec2(.5)).r,.02),.4,uExMax)*uFx.w;
  s*=ex;
  float l=dot(s,vec3(.3,.6,.1));
  s=mix(s,vec3(l)*vec3(.55,.9,1.35),uFx.y*.65);
  s=mix(vec3(l),s,1.1);
  s=(s*(2.51*s+.03))/(s*(2.43*s+.59)+.14);
  s=pow(clamp(s,0.,1.),vec3(1./2.2));
  s*=1.-r2*.5*(1.-pip);
  s=mix(s,vec3(1.),pip*smoothstep(.91,.94,pd));
  s=mix(s,vec3(.95,.08,.1),uFx.x*smoothstep(.08,.5,r2)*.75*(1.-pip*.6));
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

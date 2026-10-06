const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./nodePdfSource-ZI1y_ULH.js","./standardFontResolver-BflqNAB5.js"])))=>i.map(i=>d[i]);
import{n as e}from"./optionalContentData-BVq5eFtw.js";import{a as t,c as n,i as r,l as i,n as a,p as o,r as s,t as c}from"./scenePaintQuery-Dgk-86Dr.js";import{t as l}from"./retainedRasterBounds-CTuCWKTg.js";(function(){let e=document.createElement(`link`).relList;if(e&&e.supports&&e.supports(`modulepreload`))return;for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);new MutationObserver(e=>{for(let t of e)if(t.type===`childList`)for(let e of t.addedNodes)e.tagName===`LINK`&&e.rel===`modulepreload`&&n(e)}).observe(document,{childList:!0,subtree:!0});function t(e){let t={};return e.integrity&&(t.integrity=e.integrity),e.referrerPolicy&&(t.referrerPolicy=e.referrerPolicy),t.credentials=e.crossOrigin===`use-credentials`?`include`:e.crossOrigin===`anonymous`?`omit`:`same-origin`,t}function n(e){if(e.ep)return;e.ep=!0;let n=t(e);fetch(e.href,n)}})();var u=1e-8;function d(e,t,n,r){if(!Number.isFinite(e)||!Number.isFinite(t)||!Number.isFinite(n)||!Number.isFinite(r))return 1/0;let i=e*e+t*t+n*n+r*r,a=e*r-t*n,o=Math.max(0,i*i-4*a*a);return Math.sqrt(Math.max(0,(i+Math.sqrt(o))*.5))}function f(e,t,n,r,i){let a=Math.max(1,Math.abs(r)),o=Math.max(1,Math.abs(i)),s=Number.isFinite(n)?n:0,c=2*s/a,l=2*s/o;return new Float64Array([c,0,0,0,0,l,0,0,0,0,1,0,-e*c,-t*l,0,1])}function p(){return{visible:!0,stable:!1,maxPixelsPerLocalUnit:1/0,minPixelsPerLocalUnit:0,minX:-1/0,minY:-1/0,maxX:1/0,maxY:1/0}}function m(e,t,n,r,i,a){let o=Math.max(1,n.width),s=Math.max(1,n.height);if(!y(e)||t.length<16||!Number.isFinite(o)||!Number.isFinite(s))return b(r);let c=t[0],l=t[1],f=t[3],p=t[4],m=t[5],_=t[7],S=t[12],C=t[13],w=t[15];if(!Number.isFinite(c)||!Number.isFinite(l)||!Number.isFinite(f)||!Number.isFinite(p)||!Number.isFinite(m)||!Number.isFinite(_)||!Number.isFinite(S)||!Number.isFinite(C)||!Number.isFinite(w))return b(r);let T=1/0,E=-1/0,D=1/0,O=1/0,k=1/0,A=-1/0,j=-1/0,M=!0,N=!0,P=!0,F=!0;for(let t=0;t<4;t+=1){let n=t&1?e.maxX:e.minX,i=t&2?e.maxY:e.minY,a=c*n+p*i+S,d=l*n+m*i+C,h=f*n+_*i+w;if(!Number.isFinite(a)||!Number.isFinite(d)||!Number.isFinite(h))return b(r);if(T=Math.min(T,h),E=Math.max(E,h),D=Math.min(D,Math.abs(h)),M&&=a<-h,N&&=a>h,P&&=d<-h,F&&=d>h,Math.abs(h)>u){let e=(a/h*.5+.5)*o,t=(d/h*.5+.5)*s;if(!Number.isFinite(e)||!Number.isFinite(t))return b(r);O=Math.min(O,e),k=Math.min(k,t),A=Math.max(A,e),j=Math.max(j,t)}}if(E<-1e-8)return x(r);if(T<=u||D<=u)return b(r);let I=!(M||N||P||F),L=h(t),R,z;if(L){if(R=i?Math.hypot((c*i[0]+p*i[1])*o*.5/w,(l*i[0]+m*i[1])*s*.5/w):g(t,o,s),i&&a){let e=(c*a[0]+p*a[1])*o*.5/w,t=(l*a[0]+m*a[1])*s*.5/w,n=(c*i[0]+p*i[1])*o*.5/w,r=(l*i[0]+m*i[1])*s*.5/w,u=Math.hypot(e,t);u>0&&(R=Math.abs(e*r-t*n)/u)}z=R}else{let t=o*.5,n=s*.5,r=0,u=1/0,h=-1/0,g=1/0,y=-1/0,b=0,x=0,O=1/0,k=-1/0,A=1/0,j=-1/0,M=1/0,N=-1/0,P=1/0,F=-1/0;for(let o=0;o<4;o+=1){let s=o&1?e.maxX:e.minX,v=o&2?e.maxY:e.minY,T=c*s+p*v+S,E=l*s+m*v+C,D=f*s+_*v+w,I=(c*D-T*f)*t,L=(l*D-E*f)*n,R=(p*D-T*_)*t,z=(m*D-E*_)*n;if(i&&a){let e=I*a[0]+R*a[1],t=L*a[0]+z*a[1];u=Math.min(u,e),h=Math.max(h,e),g=Math.min(g,t),y=Math.max(y,t),b=Math.max(b,Math.hypot(e,t))}i?(I=I*i[0]+R*i[1],L=L*i[0]+z*i[1],R=z=0,r=Math.max(r,Math.hypot(I,L))):r=Math.max(r,d(I,L,R,z)),x=Math.max(x,D*D),O=Math.min(O,I),k=Math.max(k,I),A=Math.min(A,L),j=Math.max(j,L),M=Math.min(M,R),N=Math.max(N,R),P=Math.min(P,z),F=Math.max(F,z)}R=r/(D*D);let I=Math.max(v(O,k),v(A,j),v(M,N),v(P,F));if(z=x>0?I/x:0,i&&a){let e=c*(m*w-C*_)-p*(l*w-C*f)+S*(l*_-m*f),r=Math.abs(e*(a[0]*i[1]-a[1]*i[0]))*t*n,o=Math.hypot(v(u,h),v(g,y));o>0&&(R=Math.min(R,r/(T*o))),z=b>0?r/(E*b):0}}return Number.isFinite(R)?(r.visible=I,r.stable=!0,r.maxPixelsPerLocalUnit=R,r.minPixelsPerLocalUnit=Number.isFinite(z)?Math.min(z,R):0,r.minX=O,r.minY=k,r.maxX=A,r.maxY=j,r):b(r)}function h(e){return e.length>=16&&Math.abs(e[3])<=2**-52&&Math.abs(e[7])<=2**-52}function g(e,t,n){let r=1/e[15];return d(e[0]*r*t*.5,e[1]*r*n*.5,e[4]*r*t*.5,e[5]*r*n*.5)}function _(e,t){if(!h(e))return null;let n=e[0],r=e[1],i=e[4],a=e[5],o=e[12],s=e[13],c=e[15],l=n*a-i*r;if(![n,r,i,a,o,s,c,l].every(Number.isFinite)||c<=u||Math.abs(l)<=2**-52*Math.max(n*n+r*r,i*i+a*a))return null;let d=1/0,f=1/0,p=-1/0,m=-1/0;for(let e=0;e<4;e+=1){let t=(e&1?c:-c)-o,u=(e&2?c:-c)-s,h=(a*t-i*u)/l,g=(n*u-r*t)/l;d=Math.min(d,h),f=Math.min(f,g),p=Math.max(p,h),m=Math.max(m,g)}return[d,f,p,m].every(Number.isFinite)?(t.minX=d,t.minY=f,t.maxX=p,t.maxY=m,t):null}function v(e,t){return e>0?e:t<0?-t:0}function y(e){return Number.isFinite(e.minX)&&Number.isFinite(e.minY)&&Number.isFinite(e.maxX)&&Number.isFinite(e.maxY)&&e.maxX>=e.minX&&e.maxY>=e.minY}function b(e){return e.visible=!0,e.stable=!1,e.maxPixelsPerLocalUnit=1/0,e.minPixelsPerLocalUnit=0,e.minX=-1/0,e.minY=-1/0,e.maxX=1/0,e.maxY=1/0,e}function x(e){return e.visible=!1,e.stable=!0,e.maxPixelsPerLocalUnit=0,e.minPixelsPerLocalUnit=0,e.minX=0,e.minY=0,e.maxX=0,e.maxY=0,e}var S=5e4,C=1.5,w=.05,T=.5,E=1e-6,D=1/512,O=1e-9,k=1e-12,A=.001,j=8192,M=class extends Error{constructor(){super(`Text LOD build cancelled.`),this.name=`TextLodBuildCancelledError`}};function N(e){return Math.max(0,e.textInstanceCount|0)>=S}function P(e){let t=Me();try{let n=ee(e);if(typeof n==`string`)return _e(null,n,Me()-t);for(let e=0;e<n.pageCount;e+=1)te(n,e);return ne(n,t)}catch(e){return ve(e,t)}}async function F(e,t={}){let n=Me();try{let r=new ge(t);r.checkCancelled(),r.report(0,`Preparing Text LOD`);let i=ee(e);if(typeof i==`string`)return r.report(1,`Text LOD unavailable`),_e(null,i,Me()-n);let a=0;for(let e=0;e<i.pageCount;e+=1){let t=e*2,n=i.scene.pageTextRanges[t],o=n+i.scene.pageTextRanges[t+1];n===o&&te(i,e,n,o,!0,!0);for(let t=n;t<o;t+=j){let s=Math.min(o,t+j);te(i,e,t,s,t===n,s===o),a+=s-t,await r.maybeYield(!1,a/Math.max(1,i.instanceCount)*.9,`Building Text LOD pages ${e+1}/${i.pageCount}`)}}await r.maybeYield(!0,.92,`Clustering Text LOD`);let o=await re(i,n,r);return r.report(1,o.data?`Text LOD ready`:`Text LOD unavailable`),o}catch(e){return ve(e,n)}}function I(e,t){Oe(e,t);let n=t.exactInstanceCount,r=t.combinedInstanceCount,i=Math.max(0,e.textGlyphCount|0)+1,a=Math.max(0,e.textGlyphSegmentCount|0)+4,o=R(e,i,a),s={textInstanceA:new Float32Array(r*4),textInstanceB:new Float32Array(r*4),textInstanceC:new Float32Array(r*4),...o};return z(e,t,s),{scene:{...e,textInstanceCount:r,textInstanceA:s.textInstanceA,textInstanceB:s.textInstanceB,textInstanceC:s.textInstanceC,textGlyphCount:i,textGlyphSegmentCount:a,textGlyphMetaA:s.textGlyphMetaA,textGlyphMetaB:s.textGlyphMetaB,textGlyphSegmentsA:s.textGlyphSegmentsA,textGlyphSegmentsB:s.textGlyphSegmentsB},exactInstanceCount:n,coarseInstanceCount:t.coarseInstanceCount,combinedInstanceCount:r,solidGlyphIndex:t.solidGlyphIndex}}var L=new WeakMap;function R(e,t,n){let r=L.get(e.textGlyphSegmentsA)??[],i=t=>t.textGlyphMetaA===e.textGlyphMetaA&&t.textGlyphMetaB===e.textGlyphMetaB&&t.textGlyphSegmentsB===e.textGlyphSegmentsB&&t.textGlyphCount===e.textGlyphCount&&t.textGlyphSegmentCount===e.textGlyphSegmentCount,a=r.find(e=>i(e.source));if(a)return a.store;let o={textGlyphMetaA:new Float32Array(t*4),textGlyphMetaB:new Float32Array(t*4),textGlyphSegmentsA:new Float32Array(n*4),textGlyphSegmentsB:new Float32Array(n*4)};return r.push({source:e,store:o}),L.set(e.textGlyphSegmentsA,r),o}function z(e,t,n){Oe(e,t),ke(n.textInstanceA,t.combinedInstanceCount,`textInstanceA`),ke(n.textInstanceB,t.combinedInstanceCount,`textInstanceB`),ke(n.textInstanceC,t.combinedInstanceCount,`textInstanceC`),ke(n.textGlyphMetaA,t.solidGlyphIndex+1,`textGlyphMetaA`),ke(n.textGlyphMetaB,t.solidGlyphIndex+1,`textGlyphMetaB`),ke(n.textGlyphSegmentsA,Math.max(0,e.textGlyphSegmentCount|0)+4,`textGlyphSegmentsA`),ke(n.textGlyphSegmentsB,Math.max(0,e.textGlyphSegmentCount|0)+4,`textGlyphSegmentsB`);let r=t.exactInstanceCount*4;n.textInstanceA.set(e.textInstanceA.subarray(0,r),0),n.textInstanceB.set(e.textInstanceB.subarray(0,r),0),n.textInstanceC.set(e.textInstanceC.subarray(0,r),0),n.textInstanceA.set(t.coarseInstanceA,r),n.textInstanceB.set(t.coarseInstanceB,r),n.textInstanceC.set(t.coarseInstanceC,r);for(let e=0;e<t.coarseInstanceCount;e+=1)n.textInstanceB[r+e*4+2]=t.solidGlyphIndex;let i=Math.max(0,e.textGlyphCount|0)*4,a=Math.max(0,e.textGlyphSegmentCount|0)*4;n.textGlyphMetaA.set(e.textGlyphMetaA.subarray(0,i),0),n.textGlyphMetaB.set(e.textGlyphMetaB.subarray(0,i),0),n.textGlyphSegmentsA.set(e.textGlyphSegmentsA.subarray(0,a),0),n.textGlyphSegmentsB.set(e.textGlyphSegmentsB.subarray(0,a),0),n.textGlyphMetaA.set(new Float32Array([Math.max(0,e.textGlyphSegmentCount|0),4,0,0]),i),n.textGlyphMetaB.set(Ne,i),n.textGlyphSegmentsA.set(Pe,a),n.textGlyphSegmentsB.set(Fe,a)}function ee(e){let t=Math.max(0,e.textInstanceCount|0),n=Math.max(0,e.pageCount|0);return t<=0||n<=0?`empty-text`:t<5e4?`below-instance-threshold`:de(e,t,n)?e.textInstanceA.length<t*4||e.textInstanceB.length<t*4||e.textInstanceC.length<t*4?`invalid-build-data`:{scene:e,instanceCount:t,pageCount:n,inkAreas:pe(e),runs:[],coarse:new he(Math.min(t,65536)),pageRunStarts:new Uint32Array(n),pageRunCounts:new Uint32Array(n),textPaints:(e.drawRuns??[]).filter(e=>e.kind===`text`).sort((e,t)=>e.first-t.first)}:`invalid-page-ranges`}function te(e,t,n,r,i=!0,a=!0){let{scene:o,instanceCount:s}=e,c=t*2,l=Math.min(s,o.pageTextRanges[c]),u=Math.min(s,l+o.pageTextRanges[c+1]),d=Math.max(l,Math.min(u,n??l)),f=Math.max(d,Math.min(u,r??u)),p=be(o,t);i&&(e.pageRunStarts[t]=e.runs.length);let m=d;for(;m<f;){let n=0,r=e.textPaints.length;for(;n<r;){let t=n+r>>>1,i=e.textPaints[t];i.first+i.count<=m?n=t+1:r=t}let i=e.textPaints[n],a=Math.min(f,i?i.first+i.count:f),s=i?.blendMode!==void 0,c=s?null:le(e,m);if(!c){let n=m,r=null;for(;m<a&&m-n<512&&(s||!le(e,m));)r=we(r,xe(o,m,p)),m+=1;e.runs.push(ye({exactStart:n,exactCount:m-n,coarseIndex:-1,pageIndex:t,bounds:r??p,transform:[0,0,0,0,0,0],maxInkHeight:1/0,eligible:!1}));continue}let l=m,u=c.a,d=c.b,h=c.c,g=c.d,_=c.originX,v=c.originY,y=1/c.determinant,b=c.minU,x=c.minV,S=c.maxU,E=c.maxV,D=c.inkArea,k=c.inkHeight,A=Math.max(c.maxU-c.minU,O),j=(c.minU+c.maxU)*.5,M=0;for(m+=1;m<a&&m-l<512;){let t=le(e,m);if(!t||!ue(c,t))break;let n=t.originX-_,r=t.originY-v,i=(g*n-h*r)*y,a=(u*r-d*n)*y,o=Math.max(E-x,O);if(Math.abs(a)>o*w)break;let s=t.minU+i,l=t.minV+a,f=t.maxU+i,p=t.maxV+a,N=Math.max(f-s,O),P=(s+f)*.5,F=P-j,I=Math.min(A,N)*.05,L=F>I?1:F<-I?-1:0,R=M||L,z=Math.max(A,N)*C;if(R>0){if(s-S>z||F<-A*T)break}else if(R<0){if(b-f>z||F>A*T)break}else if(Math.max(s-S,b-f,0)>z)break;M===0&&L!==0&&(M=L),b=Math.min(b,s),x=Math.min(x,l),S=Math.max(S,f),E=Math.max(E,p),A=Math.max(A,N),j=P,D+=t.inkArea,k=Math.max(k,t.inkHeight),m+=1}let N=S-b,P=E-x;if(!(N>O)||!(P>O)||!Number.isFinite(D)){e.runs.push(ye({exactStart:l,exactCount:m-l,coarseIndex:-1,pageIndex:t,bounds:Se(o,l,m,p),transform:[0,0,0,0,0,0],maxInkHeight:1/0,eligible:!1}));continue}let F=[u*N,d*N,h*P,g*P,u*b+h*x+_,d*b+g*x+v],I=e.coarse.count,L=Math.min(1,Math.max(0,D/(N*P)));e.coarse.push(F[0],F[1],F[2],F[3],F[4],F[5],0,0,c.red,c.green,c.blue,c.alpha*L),e.runs.push(ye({exactStart:l,exactCount:m-l,coarseIndex:I,pageIndex:t,bounds:Ce(F),transform:F,maxInkHeight:k,eligible:!0}))}a&&(e.pageRunCounts[t]=e.runs.length-e.pageRunStarts[t])}function ne(e,t){let n=ie(e);if(n)return _e(null,n,Me()-t);let r=ae(e),i=null;for(;!i;){let e=r.next();e.done&&(i=e.value)}return _e(ce(e,i,Object.freeze(e.runs.slice()),e.coarse.trimA(),e.coarse.trimB(),e.coarse.trimC()),null,Me()-t)}async function re(e,t,n){let r=ie(e);if(r)return n.checkCancelled(),_e(null,r,Me()-t);let i=ae(e),a=null;for(;!a;){let e=i.next();if(e.done){a=e.value;break}await n.maybeYield(!1,.92+e.value*.055,`Clustering Text LOD hierarchy`)}await n.maybeYield(!0,.98,`Finalizing Text LOD run index`);let o=Object.freeze(e.runs.slice());await n.maybeYield(!0,.985,`Finalizing Text LOD instance A`);let s=e.coarse.trimA();await n.maybeYield(!0,.99,`Finalizing Text LOD instance B`);let c=e.coarse.trimB();await n.maybeYield(!0,.995,`Finalizing Text LOD instance C`);let l=e.coarse.trimC();n.checkCancelled();let u=ce(e,a,o,s,c,l);return n.checkCancelled(),_e(u,null,Me()-t)}function ie(e){let t=e.coarse.count;return t<=0?`no-coarse-runs`:t>e.instanceCount*.7?`insufficient-reduction`:null}function*ae(e){let t=[],n=[],r=Math.max(1,e.runs.length),i=0;for(let a=0;a<e.pageCount;a+=1){let o=e.pageRunStarts[a],s=o+e.pageRunCounts[a],c=t.length,l=o;for(;l<s;){let n=e.runs[l],o=n.eligible,c=l,u=0,d=0,f=null,p=0,m=0,h=oe(n,2),g=oe(n,0);for(;l<s;){let t=e.runs[l];if(t.eligible!==o||u+t.exactCount>512||o&&d+1>12)break;let n=we(f,t.bounds),r=p+Te(t.bounds);if(l>c&&Te(n)>Math.max(O,r)*4)break;f=n,p=r,u+=t.exactCount,d+=+!!t.eligible,m=Math.max(m,t.maxInkHeight),h=se(h,oe(t,2)),g=se(g,oe(t,0)),l+=1}t.push(Object.freeze({pageIndex:a,runStart:c,runCount:l-c,exactStart:n.exactStart,exactCount:u,coarseStart:o?n.coarseIndex:-1,coarseCount:d,bounds:Object.freeze(f??be(e.scene,a)),maxInkHeight:m,inkHeightDirection:h,baselineDirection:g,eligible:o})),i+=1,i>=256&&(i=0,yield Math.min(1,l/r))}let u=e.scene.pageTextRanges[a*2],d=e.scene.pageTextRanges[a*2+1],f=0,p=0,m=t[c]?.inkHeightDirection,h=t[c]?.baselineDirection,g=t.length>c,_=be(e.scene,a);for(let e=c;e<t.length;e+=1)f+=t[e].coarseCount,p=Math.max(p,t[e].maxInkHeight),m=se(m,t[e].inkHeightDirection),h=se(h,t[e].baselineDirection),g&&=t[e].eligible,_=we(_,t[e].bounds);n.push(Object.freeze({pageIndex:a,clusterStart:c,clusterCount:t.length-c,exactStart:u,exactCount:d,coarseCount:f,bounds:Object.freeze(_),maxInkHeight:p,inkHeightDirection:m,baselineDirection:h,eligible:g})),(i>0||(a+1)%32==0)&&(i=0,yield Math.max(Math.min(1,(a+1)/Math.max(1,e.pageCount)),Math.min(1,s/r)))}return{clusters:t,pages:n}}function oe(e,t){if(!e.eligible)return;let n=e.transform[t],r=e.transform[t+1],i=Math.hypot(n,r);if(!(i>0)||!Number.isFinite(i))return;let a=n<0||n===0&&r<0?-1:1;return Object.freeze([a*n/i,a*r/i])}function se(e,t){return e&&t&&e[0]===t[0]&&e[1]===t[1]?e:void 0}function ce(e,t,n,r,i,a){return Object.freeze({exactInstanceCount:e.instanceCount,coarseInstanceCount:e.coarse.count,combinedInstanceCount:e.instanceCount+e.coarse.count,solidGlyphIndex:Math.max(0,e.scene.textGlyphCount|0),runs:n,clusters:Object.freeze(t.clusters),pages:Object.freeze(t.pages),coarseInstanceA:r,coarseInstanceB:i,coarseInstanceC:a})}function le(e,t){let{scene:n}=e,r=t*4;if((n.textInstanceB[r+3]??0)>0)return null;let i=n.textInstanceA[r],a=n.textInstanceA[r+1],o=n.textInstanceA[r+2],s=n.textInstanceA[r+3],c=n.textInstanceB[r],l=n.textInstanceB[r+1],u=Math.trunc(n.textInstanceB[r+2]),d=n.textInstanceC[r],f=n.textInstanceC[r+1],p=n.textInstanceC[r+2],m=n.textInstanceC[r+3];if(![i,a,o,s,c,l,d,f,p,m].every(Number.isFinite))return null;let h=i*s-a*o,g=Math.max(0,n.textGlyphCount|0);if(Math.abs(h)<=k||u<0||u>=g)return null;let _=u*4;if(_+3>=n.textGlyphMetaA.length||_+1>=n.textGlyphMetaB.length)return null;let v=n.textGlyphMetaA[_+2],y=n.textGlyphMetaA[_+3],b=n.textGlyphMetaB[_],x=n.textGlyphMetaB[_+1],S=x-y,C=S*Math.hypot(o,s);return![v,y,b,x,C].every(Number.isFinite)||!(b-v>O)||!(S>O)||!(C>O)?null:{a:i,b:a,c:o,d:s,determinant:h,originX:c,originY:l,minU:v,minV:y,maxU:b,maxV:x,inkArea:e.inkAreas[u]??0,inkHeight:C,red:d,green:f,blue:p,alpha:m}}function ue(e,t){return Math.abs(e.a-t.a)<=E&&Math.abs(e.b-t.b)<=E&&Math.abs(e.c-t.c)<=E&&Math.abs(e.d-t.d)<=E&&Math.abs(e.red-t.red)<=D&&Math.abs(e.green-t.green)<=D&&Math.abs(e.blue-t.blue)<=D&&Math.abs(e.alpha-t.alpha)<=D}function de(e,t,n){if(!(e.pageTextRanges instanceof Uint32Array)||e.pageTextRanges.length<n*2)return!1;let r=0;for(let i=0;i<n;i+=1){let n=e.pageTextRanges[i*2],a=e.pageTextRanges[i*2+1];if(n!==r||a>t-r)return!1;r+=a}return r===t}function fe(e,t,n,r,i){let a=me(e,t,r,i);for(let r=0;r<e;r+=1){let e=r*4,i=(n[e]-t[e+2])*(n[e+1]-t[e+3]);n[e+2]=i>0&&Number.isFinite(i)?Math.min(1,a[r]/i):0}}function pe(e){return me(Math.max(0,e.textGlyphCount|0),e.textGlyphMetaA,e.textGlyphSegmentsA,e.textGlyphSegmentsB)}function me(e,t,n,r){let i=new Float32Array(e);for(let a=0;a<e;a+=1){let e=a*4,o=Math.max(0,Math.trunc(t[e]??0)),s=Math.max(0,Math.trunc(t[e+1]??0)),c=0,l=!1,u=0,d=0,f=0,p=0;for(let e=0;e<s;e+=1){let t=(o+e)*4;if(t+3>=n.length||t+3>=r.length)break;let i=n[t],a=n[t+1],s=n[t+2],m=n[t+3],h=r[t],g=r[t+1],_=r[t+2];[i,a,s,m,h,g,_].every(Number.isFinite)&&((!l||!je(i,a,f,p))&&(l&&(c+=f*d-p*u),l=!0,u=i,d=a),c+=_>=.5?2/3*(i*m-a*s)+1/3*(i*g-a*h)+2/3*(s*g-m*h):i*g-a*h,f=h,p=g)}l&&(c+=f*d-p*u),i[a]=Math.abs(c)*.5}return i}var he=class{capacity;a;b;c;count=0;constructor(e){this.capacity=Math.max(16,e),this.a=new Float32Array(this.capacity*4),this.b=new Float32Array(this.capacity*4),this.c=new Float32Array(this.capacity*4)}push(e,t,n,r,i,a,o,s,c,l,u,d){this.count>=this.capacity&&this.grow();let f=this.count*4;this.a.set([e,t,n,r],f),this.b.set([i,a,o,s],f),this.c.set([c,l,u,d],f),this.count+=1}trimA(){return this.a.slice(0,this.count*4)}trimB(){return this.b.slice(0,this.count*4)}trimC(){return this.c.slice(0,this.count*4)}grow(){this.capacity*=2,this.a=Ae(this.a,this.capacity*4),this.b=Ae(this.b,this.capacity*4),this.c=Ae(this.c,this.capacity*4)}},ge=class{options;yieldIntervalMs;lastYieldAt=Me();lastProgress=-1;constructor(e){this.options=e,this.yieldIntervalMs=Math.max(1,e.yieldIntervalMs??50)}checkCancelled(){if(this.options.signal?.aborted||this.options.shouldCancel?.())throw new M}report(e,t){let n=Math.max(this.lastProgress,Math.min(1,Math.max(0,e)));this.lastProgress=n,this.options.onProgress?.({value:n,message:t})}async maybeYield(e,t,n){this.checkCancelled(),this.report(t,n),!(!e&&Me()-this.lastYieldAt<this.yieldIntervalMs)&&(await new Promise(e=>globalThis.setTimeout(e,0)),this.lastYieldAt=Me(),this.checkCancelled())}};function _e(e,t,n){return Object.freeze({data:e,fallbackReason:t,buildTimeMs:Math.max(0,n)})}function ve(e,t){if(e instanceof RangeError&&/allocation failed|array buffer|invalid (?:typed )?array length|out of memory|length too large|maximum array/i.test(e.message))return _e(null,`resource-capacity`,Me()-t);throw e}function ye(e){return Object.freeze({...e,bounds:Object.freeze(Ee(e.bounds)),transform:Object.freeze([...e.transform])})}function be(e,t){let n=t*4;if(n+3<e.pageRects.length){let t=e.pageRects[n],r=e.pageRects[n+1],i=e.pageRects[n+2],a=e.pageRects[n+3],o={minX:Math.min(t,i),minY:Math.min(r,a),maxX:Math.max(t,i),maxY:Math.max(r,a)};if(De(o))return o}return De(e.bounds)?Ee(e.bounds):{minX:0,minY:0,maxX:0,maxY:0}}function xe(e,t,n){let r=t*4,i=e.textInstanceA[r],a=e.textInstanceA[r+1],o=e.textInstanceA[r+2],s=e.textInstanceA[r+3],c=e.textInstanceB[r],l=e.textInstanceB[r+1],u=Math.trunc(e.textInstanceB[r+2]),d=u*4;if([i,a,o,s,c,l].every(Number.isFinite)&&u>=0&&d+3<e.textGlyphMetaA.length&&d+1<e.textGlyphMetaB.length){let t=e.textGlyphMetaA[d+2],n=e.textGlyphMetaA[d+3],r=e.textGlyphMetaB[d],u=e.textGlyphMetaB[d+1];if([t,n,r,u].every(Number.isFinite))return Ce([i*(r-t),a*(r-t),o*(u-n),s*(u-n),i*t+o*n+c,a*t+s*n+l])}return Ee(n)}function Se(e,t,n,r){let i=null;for(let a=t;a<n;a+=1)i=we(i,xe(e,a,r));return i??Ee(r)}function Ce(e){let[t,n,r,i,a,o]=e,s=a,c=o,l=t+a,u=n+o,d=r+a,f=i+o,p=t+r+a,m=n+i+o;return{minX:Math.min(s,l,d,p),minY:Math.min(c,u,f,m),maxX:Math.max(s,l,d,p),maxY:Math.max(c,u,f,m)}}function we(e,t){return e?{minX:Math.min(e.minX,t.minX),minY:Math.min(e.minY,t.minY),maxX:Math.max(e.maxX,t.maxX),maxY:Math.max(e.maxY,t.maxY)}:Ee(t)}function Te(e){return Math.max(0,e.maxX-e.minX)*Math.max(0,e.maxY-e.minY)}function Ee(e){return{minX:e.minX,minY:e.minY,maxX:e.maxX,maxY:e.maxY}}function De(e){return Number.isFinite(e.minX)&&Number.isFinite(e.minY)&&Number.isFinite(e.maxX)&&Number.isFinite(e.maxY)&&e.maxX>=e.minX&&e.maxY>=e.minY}function Oe(e,t){if(t.exactInstanceCount!==Math.max(0,e.textInstanceCount|0)||t.solidGlyphIndex!==Math.max(0,e.textGlyphCount|0)||t.combinedInstanceCount!==t.exactInstanceCount+t.coarseInstanceCount)throw Error(`Text LOD build data does not belong to this scene.`)}function ke(e,t,n){if(e.length<t*4)throw RangeError(`${n} requires at least ${t*4} floats.`)}function Ae(e,t){let n=new Float32Array(t);return n.set(e),n}function je(e,t,n,r){return Math.abs(e-n)<=A&&Math.abs(t-r)<=A}function Me(){return typeof performance<`u`&&typeof performance.now==`function`?performance.now():Date.now()}var Ne=new Float32Array([1,1,0,0]),Pe=new Float32Array([0,0,0,0,1,0,0,0,1,1,0,0,0,1,0,0]),Fe=new Float32Array([1,0,0,0,1,1,0,0,0,1,0,0,0,0,0,0]),Ie=`modulepreload`,Le=function(e,t){return new URL(e,t).href},Re={},ze=function(e,t,n){let r=Promise.resolve();if(t&&t.length>0){let e=document.getElementsByTagName(`link`),i=document.querySelector(`meta[property=csp-nonce]`),a=i?.nonce||i?.getAttribute(`nonce`);function o(e){return Promise.all(e.map(e=>Promise.resolve(e).then(e=>({status:`fulfilled`,value:e}),e=>({status:`rejected`,reason:e}))))}function s(e){return import.meta.resolve?import.meta.resolve(e):new URL(e,import.meta.url).href}r=o(t.map(t=>{if(t=Le(t,n),t=s(t),t in Re)return;Re[t]=!0;let r=t.endsWith(`.css`);for(let n=e.length-1;n>=0;n--){let i=e[n];if(i.href===t&&(!r||i.rel===`stylesheet`))return}let i=document.createElement(`link`);if(i.rel=r?`stylesheet`:Ie,r||(i.as=`script`),i.crossOrigin=``,i.href=t,a&&i.setAttribute(`nonce`,a),document.head.appendChild(i),r)return new Promise((e,n)=>{i.addEventListener(`load`,e),i.addEventListener(`error`,()=>n(Error(`Unable to preload CSS for ${t}`)))})}).filter(e=>e!==void 0))}function i(e){let t=new Event(`vite:preloadError`,{cancelable:!0});if(t.payload=e,window.dispatchEvent(t),!t.defaultPrevented)throw e}return r.then(t=>{for(let e of t||[])e.status===`rejected`&&i(e.reason);return e().catch(i)})},Be=.5,Ve=.75,He=.1,Ue=2e5,We=new WeakMap,Ge=new WeakMap;function Ke(e){return We.get(e)??null}function qe(e){let t=We.get(e);if(t)return t;let n=P(e);return We.set(e,n),n}function Je(e,t={}){let n=We.get(e);if(n)return Promise.resolve(n);let r=Ge.get(e);if(r)return r;let i=Ye(e,t).then(t=>(We.set(e,t),Ge.delete(e),t),t=>{throw Ge.delete(e),t});return Ge.set(e,i),i}async function Ye(e,t){if(typeof Worker<`u`&&N(e)){let n;try{n=await ze(()=>import(`./lodWorkerClient-DmY8da4m.js`),[],import.meta.url)}catch(e){console.warn(`[HEPR] LOD worker module unavailable; preparing cooperatively.`,e)}if(!n)return F(e,t);let r=0,i={...t,onProgress:e=>{r=Math.max(r,e.value),t.onProgress?.({...e,value:r})}};return await n.buildTextLodInWorker(e,i)||F(e,i)}return F(e,t)}function Xe(e,t){We.set(e,t)}var Ze=class{data;buildTimeMs;buildFallbackReason;resourceFallbackReason=null;mode;clusterStates;clusterVisibility;selectedInstanceIds=new Uint32Array;exactIdentityInstanceIds=null;selectionScratch=new Uint32Array;selectionInitialized=!1;lastUpdateValid=!1;lastPageMatrices;lastPageRevision;lastLocalToClip=new Float64Array(16);lastViewportWidth=0;lastViewportHeight=0;lastHasCullingBounds=!1;lastCullingBounds=new Float64Array(4);selectionUploads=0;stats;pageProjection=p();clusterProjection=p();selectionViewportScratch={width:1,height:1};visibilityBounds={minX:0,minY:0,maxX:0,maxY:0};affineViewBounds={minX:0,minY:0,maxX:0,maxY:0};affineVisibility={minX:0,minY:0,maxX:0,maxY:0};affineScale=0;lastAffineValid=!1;lastAffineScale=0;affineBasis=new Float64Array(4);lastAffineBasis=new Float64Array(4);lastAffineVisibility=new Float64Array(4);constructor(e,t=`auto`){this.data=e.data,this.buildTimeMs=e.buildTimeMs,this.buildFallbackReason=e.fallbackReason,this.mode=t,this.clusterStates=new Uint8Array(e.data?.clusters.length??0),this.clusterVisibility=new Uint8Array(e.data?.clusters.length??0),this.stats=this.createEmptyStats()}setMode(e){if(e!==`auto`&&e!==`off`)throw RangeError(`Unsupported Text LOD mode: ${String(e)}`);e!==this.mode&&(this.mode=e,e===`off`&&this.clusterStates.fill(0),this.selectionInitialized=!1,this.lastUpdateValid=!1,this.lastAffineValid=!1,this.stats=this.createEmptyStats())}getMode(){return this.mode}setResourceFallback(e){let t=e&&e.length>0?e:null;t!==this.resourceFallbackReason&&(this.resourceFallbackReason=t,this.selectionInitialized=!1,this.lastUpdateValid=!1,this.lastAffineValid=!1,this.stats=this.createEmptyStats())}update(e){let t=this.data;if(!t||this.resourceFallbackReason)return this.finishUnavailableSelection();let n=e.pixelRatio??1;if(Number.isFinite(n)&&n>1&&(e={...e,viewportWidth:e.viewportWidth/n,viewportHeight:e.viewportHeight/n}),this.selectionInitialized&&this.isSameSelectionUpdate(e))return{instanceIds:this.selectedInstanceIds,changed:!1,stats:this.getStats()};let r=!e.pageLocalToClip&&this.resolveAffineView(e);if(r&&this.selectionInitialized&&this.isSameAffineSelection())return this.rememberSelectionUpdate(e),{instanceIds:this.selectedInstanceIds,changed:!1,stats:this.getStats()};let i=!this.selectionInitialized,a=!1,o=0,s=0,c=0,l=0,u=0,d=r?this.affineVisibility:this.resolveVisibilityBounds(e.cullingBounds);for(let n of t.pages){let i=e.pageLocalToClip?.[n.pageIndex]??e.localToClip;if(e.pageVisibility?.[n.pageIndex]===0||d&&!at(n.bounds,d)){rt(n.clusterStart,n.clusterCount,this.clusterVisibility)&&(a=!0);continue}let f=r?null:m(n.bounds,i,this.selectionViewport(e),this.pageProjection,n.inkHeightDirection,n.baselineDirection);if(f&&f.stable&&!f.visible){rt(n.clusterStart,n.clusterCount,this.clusterVisibility)&&(a=!0);continue}let p=!f||f.stable,h=f?f.maxPixelsPerLocalUnit:this.affineInkHeightScale(n.inkHeightDirection,n.baselineDirection),g=n.eligible&&n.clusterCount>0&&ot(this.clusterStates,n.clusterStart,n.clusterCount,1),_=g?Ve:Be;if(this.mode===`auto`&&n.eligible&&p&&(g?n.maxInkHeight*h<_:n.maxInkHeight*h<=_)){let e=n.clusterStart+n.clusterCount;for(let r=n.clusterStart;r<e;r+=1){let e=t.clusters[r];it(this.clusterVisibility,r,1)&&(a=!0),it(this.clusterStates,r,1)&&(a=!0),o+=1,c+=1,u+=e.coarseCount}continue}let v=f!==null&&f.stable&&et(f,e),y=n.clusterStart+n.clusterCount;for(let r=n.clusterStart;r<y;r+=1){let p=t.clusters[r];if(d&&!at(p.bounds,d)){it(this.clusterVisibility,r,0)&&(a=!0);continue}let h=this.clusterStates[r]===1,g=this.mode===`auto`&&p.eligible,_=-1;if(f?v&&(g?$e(p.maxInkHeight*f.maxPixelsPerLocalUnit,h)?_=1:(n.inkHeightDirection||!p.inkHeightDirection)&&(n.baselineDirection||!p.baselineDirection)&&p.maxInkHeight*f.minPixelsPerLocalUnit>=.75&&(_=0):_=0):_=g&&$e(p.maxInkHeight*this.affineInkHeightScale(p.inkHeightDirection,p.baselineDirection),h)?1:0,_<0){let t=m(p.bounds,i,this.selectionViewport(e),this.clusterProjection,p.inkHeightDirection,p.baselineDirection);if(t.stable&&!t.visible){it(this.clusterVisibility,r,0)&&(a=!0);continue}_=g&&t.stable&&$e(p.maxInkHeight*t.maxPixelsPerLocalUnit,h)?1:0}it(this.clusterVisibility,r,1)&&(a=!0),o+=1;let y=_===1;it(this.clusterStates,r,+!!y)&&(a=!0),y?(c+=1,u+=p.coarseCount):(s+=1,l+=p.exactCount)}}let f=i||a;return f&&(this.selectedInstanceIds=this.buildSelectedInstanceIds(t,o===t.clusters.length&&c===0&&l===t.exactInstanceCount),this.selectionUploads+=1,this.selectionInitialized=!0),this.stats={mode:this.mode,available:!0,fallbackReason:null,buildTimeMs:this.buildTimeMs,totalRuns:t.runs.length,totalClusters:t.clusters.length,visibleClusters:o,exactClusters:s,coarseClusters:c,renderedGlyphs:l,renderedRuns:u,selectedInstances:this.selectedInstanceIds.length,selectionUploads:this.selectionUploads,exactBudgetOverage:Math.max(0,l-Ue)},this.rememberSelectionUpdate(e),this.rememberAffineSelection(r),{instanceIds:this.selectedInstanceIds,changed:f,stats:this.getStats()}}resolveAffineView(e){let t=Math.max(1,e.viewportWidth),n=Math.max(1,e.viewportHeight);if(!Number.isFinite(t)||!Number.isFinite(n))return!1;let r=_(e.localToClip,this.affineViewBounds);if(!r)return!1;let i=g(e.localToClip,t,n);if(!Number.isFinite(i))return!1;let a=e.cullingBounds;a&&(r.minX=Math.max(r.minX,a.minX),r.minY=Math.max(r.minY,a.minY),r.maxX=Math.min(r.maxX,a.maxX),r.maxY=Math.min(r.maxY,a.maxY));let o=this.lastAffineValid&&i===this.lastAffineScale?this.resolveVisibilityBounds(r)??r:r,s=this.affineVisibility;s.minX=o.minX,s.minY=o.minY,s.maxX=o.maxX,s.maxY=o.maxY,this.affineScale=i;let c=e.localToClip,l=c[15];return this.affineBasis[0]=c[0]/l*t*.5,this.affineBasis[1]=c[1]/l*n*.5,this.affineBasis[2]=c[4]/l*t*.5,this.affineBasis[3]=c[5]/l*n*.5,!0}affineInkHeightScale(e,t){if(!e)return this.affineScale;let n=this.affineBasis,r=n[0]*e[0]+n[2]*e[1],i=n[1]*e[0]+n[3]*e[1];if(t){let e=n[0]*t[0]+n[2]*t[1],a=n[1]*t[0]+n[3]*t[1],o=Math.hypot(e,a);if(o>0)return Math.abs(e*i-a*r)/o}return Math.hypot(r,i)}isSameAffineSelection(){let e=this.affineVisibility;return this.lastAffineValid&&this.affineScale===this.lastAffineScale&&this.affineBasis[0]===this.lastAffineBasis[0]&&this.affineBasis[1]===this.lastAffineBasis[1]&&this.affineBasis[2]===this.lastAffineBasis[2]&&this.affineBasis[3]===this.lastAffineBasis[3]&&e.minX===this.lastAffineVisibility[0]&&e.minY===this.lastAffineVisibility[1]&&e.maxX===this.lastAffineVisibility[2]&&e.maxY===this.lastAffineVisibility[3]}rememberAffineSelection(e){this.lastAffineValid=e,e&&(this.lastAffineScale=this.affineScale,this.lastAffineBasis.set(this.affineBasis),this.lastAffineVisibility[0]=this.affineVisibility.minX,this.lastAffineVisibility[1]=this.affineVisibility.minY,this.lastAffineVisibility[2]=this.affineVisibility.maxX,this.lastAffineVisibility[3]=this.affineVisibility.maxY)}resolveVisibilityBounds(e){if(!e)return null;let t=Qe((e.maxX-e.minX)*He),n=Qe((e.maxY-e.minY)*He);if(t<=0||n<=0)return e;let r=this.visibilityBounds;return r.minX=Math.floor(e.minX/t)*t,r.minY=Math.floor(e.minY/n)*n,r.maxX=Math.ceil(e.maxX/t)*t,r.maxY=Math.ceil(e.maxY/n)*n,r}selectionViewport(e){return this.selectionViewportScratch.width=e.viewportWidth,this.selectionViewportScratch.height=e.viewportHeight,this.selectionViewportScratch}getSelectedInstanceIds(){return this.selectedInstanceIds}getStats(){return{...this.stats}}dispose(){this.data=null,this.clusterStates=new Uint8Array,this.clusterVisibility=new Uint8Array,this.selectedInstanceIds=new Uint32Array,this.exactIdentityInstanceIds=null,this.selectionScratch=new Uint32Array,this.selectionInitialized=!1,this.lastUpdateValid=!1,this.lastAffineValid=!1,this.stats=this.createEmptyStats()}finishUnavailableSelection(){let e=this.selectedInstanceIds.length!==0;return e&&(this.selectedInstanceIds=new Uint32Array,this.selectionUploads+=1),this.selectionInitialized=!0,this.stats=this.createEmptyStats(),{instanceIds:this.selectedInstanceIds,changed:e,stats:this.getStats()}}createEmptyStats(){return{mode:this.mode,available:this.data!==null&&this.resourceFallbackReason===null,fallbackReason:this.resourceFallbackReason??this.buildFallbackReason,buildTimeMs:this.buildTimeMs,totalRuns:this.data?.runs.length??0,totalClusters:this.data?.clusters.length??0,visibleClusters:0,exactClusters:0,coarseClusters:0,renderedGlyphs:0,renderedRuns:0,selectedInstances:0,selectionUploads:this.selectionUploads,exactBudgetOverage:0}}buildSelectedInstanceIds(e,t){let n=this.ensureIdentityInstanceIds(e);if(t)return n.subarray(0,e.exactInstanceCount);this.selectionScratch.length<e.combinedInstanceCount&&(this.selectionScratch=new Uint32Array(e.combinedInstanceCount));let r=this.selectionScratch,i=0,a=0,o=0;for(let t=0;t<e.clusters.length;t+=1){if(this.clusterVisibility[t]===0)continue;let s=e.clusters[t],c=this.clusterStates[t]===1?e.exactInstanceCount+s.coarseStart:s.exactStart,l=this.clusterStates[t]===1?s.coarseCount:s.exactCount;if(!(l<=0)){if(c===o){o+=l;continue}i=nt(r,i,n,a,o),a=c,o=c+l}}return i=nt(r,i,n,a,o),r.subarray(0,i)}ensureIdentityInstanceIds(e){let t=this.exactIdentityInstanceIds;if(!t||t.length<e.combinedInstanceCount){t=new Uint32Array(e.combinedInstanceCount);for(let e=0;e<t.length;e+=1)t[e]=e;this.exactIdentityInstanceIds=t}return t}isSameSelectionUpdate(e){if(!this.lastUpdateValid||e.localToClip.length<16||this.lastPageMatrices!==e.pageLocalToClip||this.lastPageRevision!==e.pageRevision||e.pageLocalToClip&&e.pageRevision===void 0||Number(e.viewportWidth)!==this.lastViewportWidth||Number(e.viewportHeight)!==this.lastViewportHeight)return!1;if(!e.pageLocalToClip){for(let t=0;t<16;t+=1)if(Number(e.localToClip[t])!==this.lastLocalToClip[t])return!1}let t=e.cullingBounds;return t!=null===this.lastHasCullingBounds?!t||t.minX===this.lastCullingBounds[0]&&t.minY===this.lastCullingBounds[1]&&t.maxX===this.lastCullingBounds[2]&&t.maxY===this.lastCullingBounds[3]:!1}rememberSelectionUpdate(e){if(this.lastPageMatrices=e.pageLocalToClip,this.lastPageRevision=e.pageRevision,e.localToClip.length<16){this.lastUpdateValid=!1;return}for(let t=0;t<16;t+=1)this.lastLocalToClip[t]=Number(e.localToClip[t]);this.lastViewportWidth=Number(e.viewportWidth),this.lastViewportHeight=Number(e.viewportHeight);let t=e.cullingBounds;this.lastHasCullingBounds=t!=null,t&&(this.lastCullingBounds[0]=t.minX,this.lastCullingBounds[1]=t.minY,this.lastCullingBounds[2]=t.maxX,this.lastCullingBounds[3]=t.maxY),this.lastUpdateValid=!0}};function Qe(e){return!Number.isFinite(e)||e<=0?0:2**Math.round(Math.log2(e))}function $e(e,t){return t?e<Ve:e<=Be}function et(e,t){return e.minX>=0&&e.minY>=0&&e.maxX<=Math.max(1,t.viewportWidth)&&e.maxY<=Math.max(1,t.viewportHeight)}var tt=64;function nt(e,t,n,r,i){let a=i-r;if(a<=0)return t;if(a>=tt)e.set(n.subarray(r,i),t);else for(let n=r;n<i;n+=1)e[t+n-r]=n;return t+a}function rt(e,t,n){let r=Math.min(n.length,e+t),i=!1;for(let t=e;t<r;t+=1)n[t]!==0&&(n[t]=0,i=!0);return i}function it(e,t,n){return e[t]!==n&&(e[t]=n,!0)}function at(e,t){return e.maxX>=t.minX&&e.minX<=t.maxX&&e.maxY>=t.minY&&e.minY<=t.maxY}function ot(e,t,n,r){let i=Math.min(e.length,t+n);for(let n=t;n<i;n+=1)if(e[n]!==r)return!1;return i-t===n}function st(e,t){if(e===void 0)return;let n=()=>{throw Error(`Invalid PDF page mapping metadata.`)};(!Array.isArray(e)||e.length>t)&&n();let r=new Set;for(let i of e){(!i||!Number.isSafeInteger(i.pageIndex)||i.pageIndex<0||i.pageIndex>=t||r.has(i.pageIndex)||!Number.isSafeInteger(i.sourcePageIndex)||i.sourcePageIndex<0||!Array.isArray(i.pdfToScene)||i.pdfToScene.length!==6||![...i.pdfToScene].every(Number.isFinite))&&n();let[e,a,o,s]=i.pdfToScene;(!Number.isFinite(e*s-a*o)||e*s-a*o===0)&&n(),r.add(i.pageIndex)}}var ct=Object.freeze({count:262144,numbers:2e6,text:8e6,actions:4096,depth:32}),lt=Object.freeze([`render`,`forms`,`none`]);function ut(e){if(e!==void 0&&!lt.includes(e))throw RangeError(`annotationAppearances must be "render", "forms" or "none".`)}function dt(e,t){return e===void 0||e===`render`||e===`forms`&&t===`Widget`}function ft(e,t){let n=[];for(let r=0;r<e.length;r+=2)n.push(t[0]*e[r]+t[2]*e[r+1]+t[4],t[1]*e[r]+t[3]*e[r+1]+t[5]);return n}function pt(e,t){let n=ft([e[0],e[1],e[2],e[1],e[2],e[3],e[0],e[3]],t);return{minX:Math.min(n[0],n[2],n[4],n[6]),minY:Math.min(n[1],n[3],n[5],n[7]),maxX:Math.max(n[0],n[2],n[4],n[6]),maxY:Math.max(n[1],n[3],n[5],n[7])}}function mt(e,t){return{bounds:pt(e.rect,t),...e.quadPoints?{quadPoints:ft(e.quadPoints,t)}:{},...e.line?{line:ft(e.line,t)}:{},...e.vertices?{vertices:ft(e.vertices,t)}:{},...e.inkList?{inkList:e.inkList.map(e=>ft(e,t))}:{}}}function ht(e,t,n=0,r=0,i=0){let{minX:a,minY:o,maxX:s,maxY:c}=e.bounds;return{...e,pageIndex:t,...mt({rect:[a,o,s,c],quadPoints:e.quadPoints,line:e.line,vertices:e.vertices,inkList:e.inkList},[1,0,0,1,n,r]),...e.optionalContent===void 0?{}:{optionalContent:e.optionalContent+i}}}function gt(e,t){let n=()=>{throw Error(`Invalid annotation metadata.`)},r=e=>((!e||typeof e!=`object`||Array.isArray(e)||Object.getPrototypeOf(e)!==Object.prototype)&&n(),e),i=0,a=0,o=0,s=e=>Number.isSafeInteger(e)&&e>=0,c=e=>{(typeof e!=`string`||(a+=e.length)>ct.text)&&n()},l=(e,t,r=t)=>{(!Array.isArray(e)||e.length<r||e.length%t||(i+=e.length)>ct.numbers||e.some(e=>typeof e!=`number`||!Number.isFinite(e)))&&n()},u=e=>{for(let t of[`quadPoints`,`line`,`vertices`])e[t]!==void 0&&(l(e[t],t===`quadPoints`?8:2,t===`line`?4:t===`quadPoints`?8:2),t===`line`&&e[t].length!==4&&n());if(e.inkList!==void 0){(!Array.isArray(e.inkList)||e.inkList.length>ct.numbers)&&n();for(let t of e.inkList)l(t,2)}},d=e=>{let t=r(e);for(let e of[`name`,`fit`])t[e]!==void 0&&c(t[e]);for(let e of[`sourcePageIndex`,`remotePageIndex`])t[e]!==void 0&&!s(t[e])&&n();t.parameters!==void 0&&(!Array.isArray(t.parameters)||t.parameters.length>4||t.parameters.some(e=>e!==null&&(typeof e!=`number`||!Number.isFinite(e))))&&n()},f=new Set,p=(e,t=0)=>{(t>=ct.depth||++o>ct.actions||f.has(e))&&n(),f.add(e);let i=r(e);c(i.type);for(let e of[`uri`,`uriBase`,`file`,`name`])i[e]!==void 0&&c(i[e]);if(i.destination!==void 0&&d(i.destination),i.next!==void 0){Array.isArray(i.next)||n();for(let e of i.next)p(e,t+1)}f.delete(e)};(!Array.isArray(e)||e.length>ct.count)&&n();for(let i of e){let e=r(i);c(e.id),c(e.subtype),(!s(e.sourcePageIndex)||!s(e.annotationIndex)||!s(e.flags)||e.flags>4294967295||typeof e.visibleInDefaultView!=`boolean`||typeof e.hasAppearance!=`boolean`)&&n(),t.sourcePageIndex!==void 0&&e.sourcePageIndex!==t.sourcePageIndex&&n(),t.pageCount!==void 0&&(!s(e.pageIndex)||e.pageIndex>=t.pageCount)&&n(),e.optionalContent!==void 0&&(!s(e.optionalContent)||e.optionalContent>=t.conditionCount)&&n();let a=r(e.bounds);l([a.minX,a.minY,a.maxX,a.maxY],4),(a.minX>a.maxX||a.minY>a.maxY)&&n();let o=r(e.pdfGeometry);l(o.rect,4),o.rect.length!==4&&n(),u(o),u(e);for(let t of[`contents`,`tooltip`,`author`,`subject`,`name`,`creationDate`,`modificationDate`,`iconName`,`popupId`,`parentId`,`replyToId`,`replyType`,`state`,`stateModel`])e[t]!==void 0&&c(e[t]);if(e.open!==void 0&&typeof e.open!=`boolean`&&n(),e.opacity!==void 0&&(typeof e.opacity!=`number`||!Number.isFinite(e.opacity)||e.opacity<0||e.opacity>1)&&n(),e.color!==void 0&&(l(e.color,1,0),(![0,1,3,4].includes(e.color.length)||e.color.some(e=>e<0||e>1))&&n()),e.border!==void 0){let t=r(e.border);(typeof t.width!=`number`||!Number.isFinite(t.width)||t.width<0)&&n(),t.style!==void 0&&c(t.style),t.dash!==void 0&&(l(t.dash,1,0),t.dash.some(e=>e<0)&&n());for(let e of[`horizontalRadius`,`verticalRadius`])t[e]!==void 0&&(typeof t[e]!=`number`||!Number.isFinite(t[e])||t[e]<0)&&n()}if(e.field!==void 0){let t=r(e.field);(!s(t.flags)||t.flags>4294967295)&&n();for(let e of[`type`,`name`])t[e]!==void 0&&c(t[e]);for(let e of[`value`,`defaultValue`]){let r=t[e];if(typeof r==`string`)c(r);else if(Array.isArray(r)){r.length>ct.count&&n();for(let e of r)c(e)}else r!=null&&typeof r!=`boolean`&&(typeof r!=`number`||!Number.isFinite(r))&&n()}}e.action!==void 0&&p(e.action),e.destination!==void 0&&d(e.destination)}}function _t(e,t){let n=e.action;if(n?.type!==`URI`||!n.uri)return null;try{let e;try{e=new URL(n.uri)}catch{let r=n.uriBase?new URL(n.uriBase,t).href:t;e=new URL(n.uri,r)}return e.protocol===`https:`||e.protocol===`http:`?e.href:null}catch{return null}}function vt(e){return e.action?e.action.type===`GoTo`?e.action.destination:void 0:e.destination}function yt(e,t,n,r){let i=vt(t);if(i?.sourcePageIndex===void 0||r.width<=0||r.height<=0)return null;let a=e.pdfPages?.find(e=>e.sourcePageIndex===i.sourcePageIndex),o=a?.pageIndex??e.annotations?.find(e=>e.sourcePageIndex===i.sourcePageIndex)?.pageIndex;if(o===void 0||o<0||o>=e.pageCount)return null;let s=o*4,c=e.pageRects,l={minX:c[s],minY:c[s+1],maxX:c[s+2],maxY:c[s+3]},u=Math.max(1,r.width-48),d=Math.max(1,r.height-48),f=e=>({centerX:(e.minX+e.maxX)/2,centerY:(e.minY+e.maxY)/2,zoom:Math.min(u/(e.maxX-e.minX),d/(e.maxY-e.minY))}),p=f(l);if(!Object.values(p).every(Number.isFinite)||p.zoom<=0)return null;if(!a)return p;let m=i.parameters??[],h=e=>typeof m[e]==`number`&&Number.isFinite(m[e])?m[e]:null,[g,_,v,y,b,x]=a.pdfToScene,S=g*y-_*v;if(!Number.isFinite(S)||S===0)return null;let C=Math.max(l.minX,Math.min(l.maxX,n.centerX)),w=Math.max(l.minY,Math.min(l.maxY,n.centerY)),T=(y*(C-b)-v*(w-x))/S,E=(-_*(C-b)+g*(w-x))/S,D=(e,t)=>ft([e,t],a.pdfToScene),O;switch(i.fit??`Fit`){case`Fit`:case`FitB`:O=p;break;case`FitR`:{let e=[h(0),h(1),h(2),h(3)];if(e.some(e=>e===null))return null;let[t,n,r,i]=e;if(r<=t||i<=n)return null;O=f(pt([t,n,r,i],a.pdfToScene));break}case`XYZ`:{let[e,t]=D(h(0)??T,h(1)??E),r=h(2);O={centerX:e,centerY:t,zoom:r&&r>0?r*96/72:Math.max(n.zoom,p.zoom)};break}case`FitH`:case`FitBH`:{let[e,t]=D(T,h(0)??E);O={...p,zoom:u/(l.maxX-l.minX)},v===0?O.centerY=t:O.centerX=e;break}case`FitV`:case`FitBV`:{let[e,t]=D(h(0)??T,E);O={...p,zoom:d/(l.maxY-l.minY)},_===0?O.centerX=e:O.centerY=t;break}default:return null}return Object.values(O).every(Number.isFinite)&&O.zoom>0?O:null}function bt(e){let t=e.getCanvas().ownerDocument.defaultView,n=new AbortController,r=0,i=!1;function a(){r&&t.cancelAnimationFrame(r),r=0}for(let r of[`pointerdown`,`wheel`])t.addEventListener(r,t=>{(r===`pointerdown`||t.target===e.getCanvas())&&a()},{capture:!0,passive:!0,signal:n.signal});t.addEventListener(`keydown`,e=>{e.key!==`Enter`&&a()},{signal:n.signal}),t.addEventListener(`blur`,a,{signal:n.signal});function o(){let t=e.getSourceUrl?.();if(t)try{return new URL(t,e.getCanvas().ownerDocument.baseURI).href}catch{return}}return{getActivationLabel(t){if(i)return null;if(_t(t,o()))return`Open link in new tab`;let n=e.getScene(),r=e.getView();return n&&r&&yt(n,t,r,e.getCanvas().getBoundingClientRect())?`Go to destination`:null},activate(n){if(i)return!1;let s=_t(n,o());if(s)return a(),t.open(s,`_blank`,`noopener,noreferrer`),!0;let c=e.getScene(),l=e.getView();if(!c||!l||!Object.values(l).every(Number.isFinite)||l.zoom<=0)return!1;let u=e.getCanvas().getBoundingClientRect(),d=yt(c,n,l,u);if(!d)return!1;if(a(),e.beforeNavigate?.(),t.matchMedia?.(`(prefers-reduced-motion: reduce)`).matches)return e.setView(d),!0;let f=e.getIdentity(),p=t.performance.now(),m=d.centerX-l.centerX,h=d.centerY-l.centerY,g=Math.hypot(m/u.width,h/u.height)*Math.min(l.zoom,d.zoom),_=450+Math.min(750,200*Math.log2(1+g)),v=Math.min(Math.log(32),Math.log(Math.hypot(1,g))),y=Math.log(l.zoom),b=Math.log(d.zoom);function x(n){if(r=0,i||e.getScene()!==c||e.getIdentity()!==f)return;let a=Math.min(1,Math.max(0,(n-p)/_));if(a===1){e.setView(d);return}let o=a*a*(3-2*a),s=4*o*(1-o);e.setView({centerX:l.centerX+m*o,centerY:l.centerY+h*o,zoom:Math.exp(y+(b-y)*o-v*s)}),r=t.requestAnimationFrame(x)}return r=t.requestAnimationFrame(x),!0},cancel:a,dispose(){i=!0,a(),n.abort()}}}function xt(e){return e.subtype===`Link`||e.destination!==void 0||e.action?.type===`URI`||e.action?.type===`GoTo`||e.action?.type===`GoToR`}var St=new WeakMap;function Ct(e,t,r){if(e.subtype===`Popup`||e.flags&35)return!1;if(e.optionalContent===void 0)return e.visibleInDefaultView;let i=r;return i||(i=St.get(t),i||(i=n(t),St.set(t,i))),i.conditions[e.optionalContent]!==0&&i.conditions[e.optionalContent]!==void 0}function wt(e,t,n){let r=t*4,i=e.pageRects;return n.x>=i[r]&&n.y>=i[r+1]&&n.x<=i[r+2]&&n.y<=i[r+3]}function Tt(e,t,n){let r=Array.from({length:4},(n,r)=>({x:e[t+r*2],y:e[t+r*2+1]})),i=r.reduce((e,t)=>e+t.x,0)/4,a=r.reduce((e,t)=>e+t.y,0)/4;r.sort((e,t)=>Math.atan2(e.y-a,e.x-i)-Math.atan2(t.y-a,t.x-i));let o=!1,s=!1;for(let e=0;e<4;e++){let t=r[e],i=r[(e+1)%4],a=(i.x-t.x)*(n.y-t.y)-(i.y-t.y)*(n.x-t.x);o||=a>1e-8,s||=a<-1e-8}return!(o&&s)&&(o||s)}function Et(e,t,n){let r=n.x-t.x,i=n.y-t.y,a=r*r+i*i,o=a?Math.max(0,Math.min(1,((e.x-t.x)*r+(e.y-t.y)*i)/a)):0;return Math.hypot(e.x-t.x-o*r,e.y-t.y-o*i)}function Dt(e,t,n,r){let i=r.clientToScenePoint(t,n);if(!i)return null;let a=r.getOptionalContentVisibility?.(),o=null,s=1/0;for(let c of e.annotations??[]){if(!Ct(c,e,a)||r.isAnnotationEnabled?.(c)===!1||!wt(e,c.pageIndex,i))continue;let l=c.bounds,u=!1,d=(l.maxX-l.minX)*(l.maxY-l.minY);if(c.quadPoints?.length){for(let e=0;e<c.quadPoints.length;e+=8)if(Tt(c.quadPoints,e,i)){u=!0;let t=c.quadPoints;d=Math.min(d,(Math.max(t[e],t[e+2],t[e+4],t[e+6])-Math.min(t[e],t[e+2],t[e+4],t[e+6]))*(Math.max(t[e+1],t[e+3],t[e+5],t[e+7])-Math.min(t[e+1],t[e+3],t[e+5],t[e+7])))}}else if(c.inkList?.length){let e=c.pdfGeometry.rect,i=Math.abs((e[2]-e[0])*(e[3]-e[1])),a=i>0?Math.sqrt(d/i):1,o=(c.border?.width??1)*a/2;for(let e of c.inkList){for(let i=0;i<e.length;i+=2){let a=r.sceneToClientPoint(e[i],e[i+1]),s=r.sceneToClientPoint(e[Math.min(i+2,e.length-2)],e[Math.min(i+3,e.length-1)]);if(!a||!s)continue;let c=r.sceneToClientPoint(e[i]+o,e[i+1]),l=r.sceneToClientPoint(e[i],e[i+1]+o),d=Math.max(c?Math.hypot(c.x-a.x,c.y-a.y):0,l?Math.hypot(l.x-a.x,l.y-a.y):0);if(Et({x:t,y:n},a,s)<=5+d){u=!0;break}}if(u)break}}else u=i.x>=l.minX&&i.x<=l.maxX&&i.y>=l.minY&&i.y<=l.maxY;u&&d<=s&&(o=c,s=d)}return o}function Ot(e,t){let n=t.ownerDocument,r=n.createElement(`strong`);if(r.textContent=e.tooltip||e.subject||e.field?.name||e.subtype,t.appendChild(r),e.contents){let r=n.createElement(`div`);r.style.cssText=`white-space:pre-wrap;margin-top:6px;`,r.textContent=e.contents,t.appendChild(r)}let i=[e.author,e.modificationDate??e.creationDate];if(e.field?.value!==void 0&&e.field.value!==null&&!(e.field.flags&8192)&&i.push(String(e.field.value)),e.action){let t=e.action;i.push(t.uri??t.file??t.name??t.destination?.name??t.type)}else e.destination&&i.push(e.destination.name??(e.destination.sourcePageIndex===void 0?`Destination`:`Page ${e.destination.sourcePageIndex+1}`));let a=n.createElement(`div`);a.style.cssText=`white-space:pre-wrap;margin-top:6px;font-size:12px;opacity:.75;`,a.textContent=i.filter(Boolean).join(`
`),t.appendChild(a)}function kt(e){let{adapter:t}=e,n=e.getCanvas()?.ownerDocument??globalThis.document,r=n.defaultView,i=n.createElement(`div`);i.className=`hepr-annotation-bubble`,i.setAttribute(`role`,`dialog`),i.setAttribute(`aria-label`,`PDF annotation`),i.style.cssText=`position:fixed;z-index:10001;box-sizing:border-box;max-width:min(360px,calc(100vw - 16px));max-height:min(320px,calc(100vh - 16px));overflow:auto;padding:12px 36px 12px 14px;border:1px solid #9ca3af;border-radius:8px;background:#fff;color:#111827;box-shadow:0 4px 16px #0003;font:14px/1.4 system-ui,sans-serif;overflow-wrap:anywhere;user-select:text;-webkit-user-select:text;pointer-events:auto;`,i.hidden=!0;let a=n.createElement(`button`);a.type=`button`,a.textContent=`×`,a.setAttribute(`aria-label`,`Close annotation`),a.style.cssText=`position:absolute;top:4px;right:5px;border:0;background:transparent;color:inherit;font:22px system-ui;cursor:pointer;`;let o=n.createElement(`div`),s=n.createElement(`button`);s.type=`button`,s.hidden=!0,s.style.cssText=`margin-top:10px;padding:5px 9px;border:1px solid #9ca3af;border-radius:4px;background:#fff;color:#1d4ed8;font:inherit;cursor:pointer;`;let c=`data-hepr-annotation-hover`,l=n.createElement(`style`);l.textContent=`canvas[${c}] { cursor: pointer !important; }`,i.appendChild(a),i.appendChild(o),i.appendChild(s),i.appendChild(l),n.body.appendChild(i);let u=new AbortController,d={capture:!0,signal:u.signal},f=e.enabled!==!1,p=!1,m=t.getScene(),h=null,g=!1,_=null,v=null,y=null,b=new Set,x=0;function S(t){if(e.pointerInteraction===!1)return;let n=t?e.getCanvas():null;v!==n&&(v?.removeAttribute(c),v=n,v?.setAttribute(c,``))}function C(){_=null,S(!1),h&&xt(h)&&w()}function w(){h=null,g=!1,i.hidden=!0}function T(){let e=t.getScene();m!==e&&(w(),C(),y=null,b.clear(),m=e)}function E(){return!f||p||!!t.isInteractionSuppressed?.()}function D(e){return!!m&&Ct(e,m,t.getOptionalContentVisibility?.())&&t.isAnnotationEnabled?.(e)!==!1}function O(){if(!h||!m)return;if(E()||!D(h)){w();return}let n=h.bounds,a=h.pageIndex*4,o=m.pageRects,s=Math.max(n.minX,o[a]),c=Math.min(n.maxX,o[a+2]),l=Math.max(n.minY,o[a+1]),u=Math.min(n.maxY,o[a+3]);if(s>c||l>u){w();return}let d=xt(h);if(d&&!_){w();return}let f=d?_:t.sceneToClientPoint((s+c)/2,u),p=e.getCanvas()?.getBoundingClientRect();if(!f||!p||f.x<p.left||f.x>p.right||f.y<p.top||f.y>p.bottom){i.hidden=!0;return}i.hidden=!1;let g=i.offsetWidth,v=i.offsetHeight,y=f.x+12,b=f.y+12;d&&y+g>r.innerWidth-8&&(y=f.x-g-12),d&&b+v>r.innerHeight-8&&(b=f.y-v-12),y=Math.max(8,Math.min(y,r.innerWidth-g-8)),b=Math.max(8,Math.min(b,r.innerHeight-v-8)),i.style.left=`${Math.round(y)}px`,i.style.top=`${Math.round(b)}px`}function k(t,n){h!==t&&(o.replaceChildren(),(e.renderContent??Ot)(t,o));let r=xt(t),c=!r&&e.onActivate?e.getActivationLabel?.(t):null;s.hidden=!c,s.textContent=c??``,a.hidden=r,i.setAttribute(`role`,r?`tooltip`:`dialog`),i.setAttribute(`aria-label`,r?`PDF link`:`PDF annotation`),i.style.pointerEvents=r?`none`:`auto`,i.style.userSelect=r?`none`:`text`,i.style.webkitUserSelect=r?`none`:`text`,i.style.paddingRight=r?`14px`:`36px`,i.style.overflow=r?`hidden`:`auto`,h=t,g=n&&!r,O()}function A(){if(x=0,T(),E()){S(!1),w();return}if(y||!_||!m){S(!1);return}let e=Dt(m,_.x,_.y,t);S(e!==null),!g&&(e?k(e,!1):w())}function j(){x||=r.requestAnimationFrame(A)}function M(){T(),h&&O(),E()||!_||y||!m?S(!1):e.pointerInteraction!==!1&&j()}function N(e){return!!e.target&&i.contains(e.target)}return r.addEventListener(`pointerdown`,t=>{if(T(),C(),N(t)){h&&!xt(h)?g=!0:w();return}if(t.target!==e.getCanvas()){w();return}if(e.pointerInteraction!==!1){if(b.add(t.pointerId),y){y.multiple=!0;return}t.button!==0||E()||(y={id:t.pointerId,start:{x:t.clientX,y:t.clientY},time:performance.now(),moved:!1,multiple:b.size>1},g||w())}},d),r.addEventListener(`pointermove`,t=>{if(e.pointerInteraction!==!1){if(y){t.pointerId===y.id&&Math.hypot(t.clientX-y.start.x,t.clientY-y.start.y)>5&&(y.moved=!0);return}if(N(t)){C();return}if(t.target!==e.getCanvas()||t.buttons!==0||t.pointerType===`touch`){C(),g||w();return}_={x:t.clientX,y:t.clientY},j()}},d),r.addEventListener(`pointerout`,t=>{e.pointerInteraction!==!1&&t.target===e.getCanvas()&&(C(),!g&&!i.contains(t.relatedTarget)&&w())},d),r.addEventListener(`pointerup`,n=>{if(e.pointerInteraction===!1||(b.delete(n.pointerId),!y||y.id!==n.pointerId))return;let r=y;if(y=null,n.pointerType!==`touch`&&n.target===e.getCanvas()&&(_={x:n.clientX,y:n.clientY},j()),r.moved||r.multiple||performance.now()-r.time>450||E()||(T(),!m))return;let i=Dt(m,n.clientX,n.clientY,t);i&&!e.onActivate?.(i)&&!xt(i)?k(i,!0):(C(),w())},d),r.addEventListener(`pointercancel`,()=>{y=null,b.clear(),C(),g||w()},d),r.addEventListener(`keydown`,t=>{if(T(),h&&!D(h)&&w(),t.key===`Escape`&&h){let t=i.contains(n.activeElement);C(),w(),t&&e.getCanvas()?.focus()}else if(t.key===`Enter`&&t.target===e.getCanvas()&&h&&!E()){t.preventDefault();let n=h;e.onActivate?.(n)||xt(n)?(C(),w()):(g=!0,a.focus())}},d),r.addEventListener(`blur`,()=>{y=null,b.clear(),C(),g||w()},{signal:u.signal}),r.addEventListener(`resize`,M,{signal:u.signal}),r.addEventListener(`scroll`,M,d),i.addEventListener(`pointerdown`,e=>e.stopPropagation(),{signal:u.signal}),s.addEventListener(`click`,()=>{T(),h&&!xt(h)&&!E()&&D(h)&&e.onActivate?.(h)&&(C(),w(),e.getCanvas()?.focus())},{signal:u.signal}),a.addEventListener(`click`,()=>{C(),w(),e.getCanvas()?.focus()},{signal:u.signal}),{enable(){p||(f=!0)},disable(){f=!1,S(!1),w()},isEnabled:()=>f&&!p,show(n,r){T(),e.pointerInteraction===!1&&(_=r??null),!E()&&m?.annotations?.includes(n)&&t.isAnnotationEnabled?.(n)!==!1&&(!xt(n)||_&&(e.pointerInteraction===!1||Dt(m,_.x,_.y,t)===n))?k(n,!0):e.pointerInteraction===!1&&w()},hide(){C(),w()},onFrame:M,sceneChanged:T,dispose(){p||(p=!0,C(),u.abort(),x&&r.cancelAnimationFrame(x),i.remove(),h=null)}}}var At=Object.freeze({aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074});function jt(e,t){return e.gradientMetaA[t*4]===2?(e.gradientMeshRanges?.[t*2+1]??0)/3:0}function Mt(e,t,n){let r=jt(e,t);if(!Number.isSafeInteger(n)||n<0||n>=r)throw RangeError(`Mesh triangle index is out of range.`);let i=[],a=[],o=e.gradientMeshRanges[t*2]+n*3,s=t*4,c=e.gradientMetaB,l=e.gradientMetaC,u=c[s]*c[s+3]-c[s+1]*c[s+2];for(let t=0;t<3;t++){let n=e.gradientMeshIndices[o+t],r=e.gradientMeshPositions[n*2]-l[s],d=e.gradientMeshPositions[n*2+1]-l[s+1];i.push({x:(c[s+3]*r-c[s+2]*d)/u,y:(-c[s+1]*r+c[s]*d)/u}),a.push(Array.from(e.gradientMeshColors.subarray(n*4,n*4+4)))}return{points:i,colors:a}}function Nt(e,t,n,r,i){let a=e.gradientMeshRanges,o=e.gradientMeshPositions,s=e.gradientMeshColors,c=e.gradientMeshIndices;if(!a||!o||!s||!c)return null;let l=a[t*2],u=l+a[t*2+1];for(let e=u-3;e>=l;e-=3){let t=c[e],a=c[e+1],l=c[e+2],u=o[t*2],d=o[t*2+1],f=o[a*2],p=o[a*2+1],m=o[l*2],h=o[l*2+1],g=(p-h)*(u-m)+(m-f)*(d-h);if(Math.abs(g)<1e-15)continue;let _=((p-h)*(n-m)+(m-f)*(r-h))/g,v=((h-d)*(n-m)+(u-m)*(r-h))/g,y=1-_-v;if(_>=-1e-7&&v>=-1e-7&&y>=-1e-7)return s[t*4+i]*_+s[a*4+i]*v+s[l*4+i]*y}return null}function Pt(e){let t=new Uint32Array(e.gradientFillPathCount*2),n=0;for(let t=0;t<e.gradientFillPathCount;t++){let r=e.gradientFillPaintMeta[t*4];r>=0&&(n+=jt(e,r)*3)}let r=new Float32Array(n*6),i=0;for(let n=0;n<e.gradientFillPathCount;n++){let a=e.gradientFillPaintMeta[n*4],o=a>=0?jt(e,a):0;t.set([i/6,o*3],n*2);for(let t=0;t<o;t++){let n=Mt(e,a,t);for(let e=0;e<3;e++)r.set([n.points[e].x,n.points[e].y,...n.colors[e]],i),i+=6}}return{vertices:r,ranges:t}}function Ft(e,t){let n=jt(e,t);if(n>65536)throw RangeError(`Mesh highlighting exceeds its triangle budget.`);let r=e.gradientMeshPositions,i=e.gradientMeshIndices,a=e.gradientMeshRanges[t*2],o=new Map,s=(e,t,n,r,i)=>{let a=n-e,s=r-t;if(!a&&!s)return;let c=Math.abs(a)>=Math.abs(s)?0:1,l=c?t:e,u=c?r:n,d=c?a/s:s/a,f=(l<u?c?e:t:c?n:r)-d*Math.min(l,u),p=`${c}:${d}:${f}`,m=o.get(p);m||o.set(p,m={axis:c,slope:d,offset:f,events:[]});let h=(u>l?1:-1)*i;m.events.push({position:Math.min(l,u),delta:h},{position:Math.max(l,u),delta:-h})};for(let e=0;e<n;e++){let t=i[a+e*3]*2,n=i[a+e*3+1]*2,o=i[a+e*3+2]*2,c=r[t],l=r[t+1],u=r[n],d=r[n+1],f=r[o],p=r[o+1],m=(u-c)*(p-l)-(d-l)*(f-c);if(!m)continue;let h=Math.sign(m);s(c,l,u,d,h),s(u,d,f,p,h),s(f,p,c,l,h)}let c=t*4,l=e.gradientMetaB,u=e.gradientMetaC,d=l[c]*l[c+3]-l[c+1]*l[c+2],f=(e,t)=>{let n=e-u[c],r=t-u[c+1];return[(l[c+3]*n-l[c+2]*r)/d,(-l[c+1]*n+l[c]*r)/d]},p=[];for(let e of o.values()){e.events.sort((e,t)=>e.position-t.position);let t=0,n=0;for(let r=0;r<e.events.length;){let i=e.events[r].position,a=t;do t+=e.events[r++].delta;while(r<e.events.length&&e.events[r].position===i);if(!a&&t&&(n=i),a&&!t){let t=e.axis?f(e.slope*n+e.offset,n):f(n,e.slope*n+e.offset),r=e.axis?f(e.slope*i+e.offset,i):f(i,e.slope*i+e.offset);p.push(...t,...r)}}}let m;if(e.gradientMetaA[c+1]>=.5){let t=e.gradientMetaE,n=[f(t[c],t[c+1]),f(t[c+2],t[c+1]),f(t[c+2],t[c+3]),f(t[c],t[c+3])];m=Float32Array.from(n.flatMap((e,t)=>[...e,...n[(t+1)%4]]))}return{edges:Float32Array.from(p),...m?{domainClip:m}:{}}}var It=24,Lt=8,Rt=512,zt=4;function Bt(e){return{pathCount:e.fillPathCount,segmentCount:e.fillSegmentCount,pathMetaA:e.fillPathMetaA,pathMetaB:e.fillPathMetaB,segmentsA:e.fillSegmentsA,segmentsB:e.fillSegmentsB}}var Vt=new WeakMap;function Ht(e){let t=Vt.get(e);if(t!==void 0)return t;let n=Ut(Bt(e));return Vt.set(e,n),n}function Ut(e){let t=e.pathCount,n=e.pathMetaA,r=e.pathMetaB,i=e.segmentsA,a=e.segmentsB;if(!t||!n||!r||!i||!a)return null;let o=new Float32Array(t*4),s=new Int32Array(t),c=0,l=0,u=0,d=e=>{let t=e*4,n=e*4,r=i[t+1],o=a[n+1];if(a[n+2]<1)return[Math.min(r,o),Math.max(r,o)];let s=i[t+3];return[Math.min(r,s,o),Math.max(r,s,o)]};for(let e=0;e<t;e++){let t=n[e*4],i=n[e*4+1],a=n[e*4+3],f=r[e*4+1]-a;if(i<It||!(f>0)||!Number.isFinite(f))continue;let p=Math.min(Rt,Math.max(1,Math.round(i/Lt))),m=0;for(;p>1;){m=0;let e=Math.fround(f/p);if(!(e>0)){p=Math.floor(p/2);continue}for(let n=t;n<t+i;n++){let[t,r]=d(n),i=Math.max(0,Math.min(p-1,Math.floor((t-a)/e))),o=Math.max(0,Math.min(p-1,Math.floor((r-a)/e)));m+=o-i+1}if(m<=i*zt)break;p=Math.floor(p/2)}p<=1||m/p>=i/2||(s[e]=p,o.set([c,p,a,f/p],e*4),c+=p,l+=m,u++)}if(!u)return null;let f=new Uint32Array(c*2),p=new Uint32Array(l);for(let e=0;e<t;e++){let t=s[e];if(!t)continue;let r=n[e*4],i=n[e*4+1],a=o[e*4],c=o[e*4+2],l=o[e*4+3],u=e=>Math.max(0,Math.min(t-1,Math.floor((e-c)/l)));for(let e=r;e<r+i;e++){let[t,n]=d(e);for(let e=u(t);e<=u(n);e++)f[(a+e)*2+1]++}}let m=0;for(let e=0;e<c;e++)f[e*2]=m,m+=f[e*2+1],f[e*2+1]=0;for(let e=0;e<t;e++){let t=s[e];if(!t)continue;let r=n[e*4],i=n[e*4+1],a=o[e*4],c=o[e*4+2],l=o[e*4+3],u=e=>Math.max(0,Math.min(t-1,Math.floor((e-c)/l)));for(let e=r;e<r+i;e++){let[t,n]=d(e);for(let r=u(t);r<=u(n);r++){let t=(a+r)*2;p[f[t]+f[t+1]++]=e}}}return{paths:o,bands:f,segments:p}}function Wt(e,t,n,r=2048){let i={data:e,texels:t,pathBase:-1,entryBase:0};if(!n)return i;let a=t+(n.paths.length/4+n.bands.length/2+Math.ceil(n.segments.length/4));if(a>Math.min(r*r,16777216)||n.segments.length>16777216)return i;let o=Gt(n,t),s=new Float32Array(a*4);return s.set(e.subarray(0,t*4)),s.set(o.data,t*4),{data:s,texels:a,pathBase:o.pathBase,entryBase:o.entryBase}}function Gt(e,t){let n=e.paths.length/4,r=e.bands.length/2,i=Math.ceil(e.segments.length/4),a=t,o=a+n,s=o+r,c=n+r+i,l=new Float32Array(c*4);for(let t=0;t<n;t++){let n=t*4;l[n]=e.paths[n+1]>0?o+e.paths[n]:0,l[n+1]=e.paths[n+1],l[n+2]=e.paths[n+2],l[n+3]=e.paths[n+3]}for(let t=0;t<r;t++){let r=(n+t)*4;l[r]=e.bands[t*2],l[r+1]=e.bands[t*2+1]}for(let t=0;t<e.segments.length;t++)l[(n+r)*4+t]=e.segments[t];return{data:l,pathBase:a,entryBase:s,texels:c}}var Kt=24,qt=8,Jt=14,Yt=4096,Xt=40,Zt=-1e30;function Qt(e,t,n,r,i,a=.5,o={}){if(r<Kt)return null;let s=o.targetPieces??qt,c=o.levelStep??1,l=o.keepHorizontal??!1,u=r*(o.texelsPerSegment??Xt),[d,f,p,m]=i,h=Math.max(p-d,m-f);if(!(h>0)||!Number.isFinite(h)||!Number.isFinite(d)||!Number.isFinite(f))return null;let g=2**Math.ceil(Math.log2(h));if(!Number.isFinite(g)||g<=0)return null;let _=[],v=0,y=0,b=0;for(let i=c;i<=Jt;i+=c){let o=g/2**i;if(Math.fround(o)!==o||o<Math.max(Math.abs(d),Math.abs(f),h)*2**-20)break;let c=Math.max(1,Math.ceil((p-d)/o)),x=Math.max(1,Math.ceil((m-f)/o));if(c*x>Yt)break;let S=en(e,t,n,r,d,f,o,c,x,a,l),C=S.pieces.length/8,w=S.closures.length/4;if(v+C+y+c*x+b+w+_.length+1>u)break;_.unshift(S),v+=C,y+=c*x,b+=w;let T=0;for(let e=0;e<c*x;e++)S.cells[e*4+1]>0&&T++;if(!T||C/T<=s)break}return _.length?{originX:d,originY:f,cellSize:g/2**(_.length*c),levelStep:c,levels:_,pieceCount:v,cellCount:y,closurePairCount:b}:null}var $t=class{values=new Float64Array(1792);columns=new Int32Array(256);count=0;push(e,t,n,r,i,a,o,s){if(this.count===this.columns.length){let e=new Float64Array(this.values.length*2);e.set(this.values),this.values=e;let t=new Int32Array(this.columns.length*2);t.set(this.columns),this.columns=t}let c=this.count*7;this.values[c]=e,this.values[c+1]=t,this.values[c+2]=n,this.values[c+3]=r,this.values[c+4]=i,this.values[c+5]=a,this.values[c+6]=o,this.columns[this.count++]=s}};function en(e,t,n,r,i,a,o,s,c,l,u){let d=e=>Math.fround(i+e*o),f=e=>Math.fround(a+e*o),p=e=>Math.max(0,Math.min(s-1,Math.floor((e-i)/o))),m=tn;m.count=0;let h=[],g=[];for(let a=n;a<n+r;a++){let n=a*4,r=e[n],c=e[n+1],f=t[n],_=t[n+1],v=+(t[n+2]>=l),y=v?e[n+2]:r,b=v?e[n+3]:c;if(!v&&c===_&&(!u||r===f))continue;let x=t[n+2],S=Math.min(r,y,f),C=Math.max(r,y,f);if(s===1||Math.floor((S-i)/o)===Math.floor((C-i)/o)){m.push(r,c,y,b,f,_,x,p(v?.25*(r+2*y+f):.5*(r+f)));continue}h.length=0;{let e=Math.max(1,Math.ceil((S-i)/o)-1),t=Math.min(s-1,Math.floor((C-i)/o)+1);for(let n=e;n<=t;n++){let e=d(n);if(e>S&&e<C){if(v){let t=r-2*y+f,n=2*(y-r),i=r-e;if(Math.abs(t)<1e-12*(Math.abs(n)+1e-30))n!==0&&an(h,-i/n,e);else{let r=n*n-4*t*i;if(r>=0){let a=-.5*(n+Math.sign(n||1)*Math.sqrt(r));an(h,a/t,e),a!==0&&an(h,i/a,e)}}}else an(h,(e-r)/(f-r),e)}}}if(!h.length){m.push(r,c,y,b,f,_,x,p(v?.25*(r+2*y+f):.5*(r+f)));continue}g.length=0;for(let e=0;e<h.length;e+=2)g.push(e);g.sort((e,t)=>h[e]-h[t]);let w=e=>(1-e)*(1-e)*r+2*(1-e)*e*y+e*e*f,T=e=>(1-e)*(1-e)*c+2*(1-e)*e*b+e*e*_,E=(e,t,n,i,a,o)=>{if(n===a&&i===o)return;let s=n,l=i;if(v){let n=1-e,i=1-t,a=n*t+e*i;s=Math.fround(n*i*r+a*y+e*t*f),l=Math.fround(n*i*c+a*b+e*t*_)}m.push(n,i,s,l,a,o,x,p(v?w(.5*(e+t)):.5*(n+a)))},D=0,O=r,k=c;for(let e of g){let t=h[e],n=h[e+1];if(t-D<1e-9)continue;let r=Math.fround(v?T(t):c+t*(_-c));E(D,t,O,k,n,r),D=t,O=n,k=r}E(D,1,O,k,f,_)}let _=m.count,v=m.values,y=new Int32Array(s+1);for(let e=0;e<_;e++)y[m.columns[e]+1]++;for(let e=0;e<s;e++)y[e+1]+=y[e];let b=new Int32Array(_),x=y.slice(0,s);for(let e=0;e<_;e++)b[x[m.columns[e]]++]=e;let S=Array(s),C=Array(s),w=new Float64Array,T=new Float64Array;S[s-1]=w,C[s-1]=T;for(let e=s-1;e>=1;e--){let t=y[e],n=y[e+1]-t,r=new Float64Array(n),i=new Float64Array(n);for(let e=0;e<n;e++){let n=b[t+e]*7;r[e]=v[n+1],i[e]=v[n+5]}r.sort(),i.sort();let[a,o]=nn(r,i);[w,T]=rn(w,T,a,o),S[e-1]=w,C[e-1]=T}let E=(Math.abs(a)+c*o)*2**-18,D=e=>Math.max(0,Math.min(c-1,Math.floor((e-a)/o))),O=new Int32Array(_*2),k=s*c,A=new Int32Array(k+1);for(let e=0;e<_;e++){let t=e*7,n=m.columns[e],r=Math.min(v[t+1],v[t+3],v[t+5]),i=Math.max(v[t+1],v[t+3],v[t+5]),a=D(r-E),o=D(i+E);O[e*2]=a,O[e*2+1]=o;for(let e=a;e<=o;e++)A[e*s+n+1]++}for(let e=0;e<k;e++)A[e+1]+=A[e];let j=new Float32Array(A[k]*8),M=A.slice(0,k);for(let e=0;e<_;e++){let t=b[e],n=t*7,r=m.columns[t];for(let e=O[t*2];e<=O[t*2+1];e++){let t=M[e*s+r]++*8;for(let e=0;e<7;e++)j[t+e]=v[n+e]}}let N=new Uint32Array(k*4),P=new Float32Array(1024),F=0,I=(e,t)=>{if(F+2>P.length){let e=new Float32Array(P.length*2);e.set(P),P=e}P[F++]=e,P[F++]=t},L=(e,t)=>{let n=0,r=e.length;for(;n<r;){let i=n+r>>1;e[i]<t?n=i+1:r=i}return n};for(let e=0;e<c;e++){let t=e===0?-1/0:f(e)-E,n=e===c-1?1/0:f(e+1)+E;for(let r=0;r<s;r++){let i=e*s+r;N[i*4]=A[i],N[i*4+1]=A[i+1]-A[i];let a=S[r],o=C[r],c=L(a,t),l=L(a,n),u=0;for(let e=0;e<c;e++)u+=o[e];let d=F;u!==0&&I(Zt,u);for(let e=c;e<l;e++)I(a[e],o[e]);(F-d)%4&&I(0,0),N[i*4+2]=d/4,N[i*4+3]=(F-d)/4}}return{columns:s,rows:c,cells:N,pieces:j,closures:P.slice(0,F)}}var tn=new $t;function nn(e,t){let n=[],r=[],i=0,a=0;for(;i<e.length||a<t.length;){let o=a>=t.length||i<e.length&&e[i]<t[a]?e[i]:t[a],s=0;for(;i<e.length&&e[i]===o;)s--,i++;for(;a<t.length&&t[a]===o;)s++,a++;s!==0&&(n.push(o),r.push(s))}return[Float64Array.from(n),Float64Array.from(r)]}function rn(e,t,n,r){if(!n.length)return[e,t];let i=[],a=[],o=0,s=0;for(;o<e.length||s<n.length;){let c,l;s>=n.length||o<e.length&&e[o]<n[s]?(c=e[o],l=t[o++]):o>=e.length||n[s]<e[o]?(c=n[s],l=r[s++]):(c=e[o],l=t[o++]+r[s++]),l!==0&&(i.push(c),a.push(l))}return[Float64Array.from(i),Float64Array.from(a)]}function an(e,t,n){t>1e-9&&t<1-1e-9&&e.push(t,n)}var on=65536,sn={targetPieces:12,levelStep:2,texelsPerSegment:8,keepHorizontal:!1};function cn(e,t=2048,n={}){let r=e.segmentCount,i=e.pathCount,a=n.base??r,o={dataA:new Float32Array,dataB:new Float32Array,texels:a,headerBase:-1,indexedPaths:0};if(!i||!e.pathMetaA||!e.pathMetaB)return o;let s=Math.min(t*t,16777216),c=Math.min(s-a-i,n.budget??Math.max(on,r*4));if(c<=0)return o;let l={...sn,...n},u=n.curveThreshold??.5,d=Array.from({length:i},(e,t)=>t).filter(t=>e.pathMetaA[t*4+1]>=Kt).sort((t,n)=>e.pathMetaA[n*4+1]-e.pathMetaA[t*4+1]||t-n),f=Array(i).fill(null),p=0,m=0,h=0,g=0,_=0;for(let t of d){let n=t*4,r=e.pathMetaA[n+1];if(p+m+h+g+r>c)continue;let i=Qt(e.segmentsA,e.segmentsB,e.pathMetaA[n],r,[e.pathMetaA[n+2],e.pathMetaA[n+3],e.pathMetaB[n],e.pathMetaB[n+1]],u,l);if(!i)continue;let a=i.pieceCount+i.levels.length+i.cellCount+i.closurePairCount;p+m+h+g+a>c||(f[t]=i,p+=i.pieceCount,m+=i.levels.length,h+=i.cellCount,g+=i.closurePairCount,_++)}if(!_)return o;let v=a+p,y=v+i,b=y+m,x=b+h,S=x+g,C=new Float32Array((S-a)*4),w=new Float32Array(p*4),T=e=>(e-a)*4,E=(e,t,n,r,i)=>{let a=T(e);C[a]=t,C[a+1]=n,C[a+2]=r,C[a+3]=i},D=a,O=y,k=b,A=x;for(let e=0;e<i;e++){let t=f[e];if(t){E(v+e,O,t.levels.length,t.cellSize,t.levelStep);for(let e of t.levels){let t=e.columns*e.rows,n=D,r=A;E(O++,k,e.columns,e.rows,0);let i=e.pieces;for(let e=0;e<i.length;e+=8,D++){let t=T(D);C[t]=i[e],C[t+1]=i[e+1],C[t+2]=i[e+4],C[t+3]=i[e+5],w[t]=i[e+2],w[t+1]=i[e+3],w[t+2]=i[e+6]}C.set(e.closures,T(A)),A+=e.closures.length/4;let a=e.cells;for(let e=0;e<t;e++){let t=a[e*4],o=a[e*4+1],s=!1;for(let e=t;e<t+o&&!s;e++)s=i[e*8+6]>=u;E(k++,n+t,s?-o:o,r+a[e*4+2],a[e*4+3])}}}}return{dataA:C,dataB:w,texels:S,headerBase:v,indexedPaths:_}}function ln(e,t,n=2048,r={}){let i=Wt(e.segmentsA,e.segmentCount,t,n),a=cn(e,n,{...r,base:i.texels}),o=new Float32Array(a.texels*4);o.set(i.data.subarray(0,i.texels*4)),o.set(a.dataA,i.texels*4);let s=new Float32Array((i.texels+a.dataB.length/4)*4);return s.set(e.segmentsB.subarray(0,e.segmentCount*4)),s.set(a.dataB,i.texels*4),{dataA:o,dataB:s,texels:a.texels,bandBase:i.pathBase,bandEntries:i.entryBase,cellBase:a.headerBase}}var un=8192,dn=4194304;function fn(e){let t=e.clipPaths;if(t===void 0)return;if(!Array.isArray(t))throw Error(`Invalid vector clip paths.`);let n=[],r=t.length;for(let e=0;e<t.length;e++){let i=t[e];if(!i||!Number.isInteger(i.parent)||i.parent<-1||i.parent>=e||i.fillRule!==0&&i.fillRule!==1||!(i.edges instanceof Float32Array)||i.edges.length%4!=0||i.edges.length/4>8192||!i.edges.every(Number.isFinite))throw Error(`Invalid vector clip path.`);let a=i.parent<0?1:n[i.parent]+1;if(a>64)throw Error(`Vector clip nesting exceeds its limit.`);if(r+=i.edges.length/4,r>4194304)throw Error(`Vector clip storage exceeds its limit.`);n.push(a)}}var pn=[-1e38,-1e38,1e38,1e38];function mn(e=[]){let t=new Float32Array(e.length*4);for(let n=0;n<e.length;n++){let r=e[n].edges,i=1/0,a=1/0,o=-1/0,s=-1/0;for(let e=0;e<r.length;e+=4)i=Math.min(i,r[e],r[e+2]),a=Math.min(a,r[e+1],r[e+3]),o=Math.max(o,r[e],r[e+2]),s=Math.max(s,r[e+1],r[e+3]);let c=e[n].parent;c>=0&&(i=Math.max(i,t[c*4]),a=Math.max(a,t[c*4+1]),o=Math.min(o,t[c*4+2]),s=Math.min(s,t[c*4+3])),t.set([i,a,o,s],n*4)}return t}function hn(e){if(e.length===16){for(let t=0;t<16;t+=4){let n=(t+4)%16,r=e[t]===e[t+2];if(r===(e[t+1]===e[t+3])||r===(e[n]===e[n+2])||e[t+2]!==e[n]||e[t+3]!==e[n+1])return}return[Math.min(e[0],e[8]),Math.min(e[1],e[9]),Math.max(e[0],e[8]),Math.max(e[1],e[9])]}}var gn=64,_n=16,vn=512,yn=4,bn=2**-126;function xn(e,t,n,r){return Math.max(0,Math.min(r-1,Math.floor(Math.fround(Math.fround(e-t)/n))))}function Sn(e){let t=e.length/4;if(t<gn)return null;let n=1/0,r=-1/0;for(let t=0;t<e.length;t+=4)n=Math.min(n,e[t+1],e[t+3]),r=Math.max(r,e[t+1],e[t+3]);let i=Math.fround(r-n);if(!(i>0)||!Number.isFinite(i))return null;let a=Math.min(vn,2**Math.ceil(Math.log2(t/_n))),o=Math.fround(i/a);if(o<bn)return null;let s=new Uint32Array(a),c=0;for(let r=0;r<e.length;r+=4){let i=e[r+1],l=e[r+3],u=Math.max(0,xn(Math.min(i,l),n,o,a)-1),d=Math.min(a-1,xn(Math.max(i,l),n,o,a)+1);if(c+=d-u+1,c>t*yn)return null;for(let e=u;e<=d;e++)s[e]++}return c/a>=t/2?null:{minY:n,height:o,counts:s,entries:c}}var Cn={targetPieces:8,levelStep:1,texelsPerSegment:12,keepHorizontal:!0};function wn(e){let t=e.length/4,n=new Float32Array(t*4),r=new Float32Array(t*4),i=1/0,a=1/0,o=-1/0,s=-1/0;for(let c=0;c<t;c++){let t=e[c*4],l=e[c*4+1],u=e[c*4+2],d=e[c*4+3];n.set([t,l,t,l],c*4),r.set([u,d,0,0],c*4),i=Math.min(i,t,u),a=Math.min(a,l,d),o=Math.max(o,t,u),s=Math.max(s,l,d)}return Qt(n,r,0,t,[i,a,o,s],.5,Cn)}function Tn(e){return 2+e.levels.length+e.cellCount+e.pieceCount+e.closurePairCount}function En(e,t){if(Tn(e)<=t)return e;let n=e.pieceCount,r=e.cellCount,i=e.closurePairCount;for(let a=1;a<e.levels.length;a++){let o=e.levels[a-1];if(n-=o.pieces.length/8,r-=o.columns*o.rows,i-=o.closures.length/4,2+e.levels.length-a+r+n+i<=t)return{...e,levels:e.levels.slice(a),cellSize:e.cellSize*2**(a*e.levelStep),pieceCount:n,cellCount:r,closurePairCount:i}}return null}function Dn(e,t){let n=2166136261;for(let t of e)n=Math.imul(n^t,16777619);return`${+!!t}:${e.length}:${n>>>0}`}function On(e=[],t=dn,n={}){if(!Number.isSafeInteger(t)||t<1||t>4194304)throw RangeError(`Invalid vector clip texture capacity.`);if(e.reduce((e,t)=>e+t.edges.length/4,e.length)>4194304)throw RangeError(`Vector clip storage exceeds its limit.`);let r=[],i=new Int32Array(e.length),a=[],o=[],s=new Map,c=e.length;for(let t=0;t<e.length;t++){let n=e[t],l=hn(n.edges),u=r[n.parent];i[t]=n.parent,l&&u&&(l[0]=Math.max(l[0],u[0]),l[1]=Math.max(l[1],u[1]),l[2]=Math.min(l[2],u[2]),l[3]=Math.min(l[3],u[3]),i[t]=i[n.parent]),r.push(l);let d=l?Float32Array.from(l):n.edges,f=new Uint32Array(d.buffer,d.byteOffset,d.length),p=Dn(f,!!l),m=s.get(p),h=m?.find(e=>e.words.every((e,t)=>e===f[t]));h||(h={edges:d,words:f,rectangle:!!l,bands:null,cells:null,coarsened:!1,offset:0},m?m.push(h):s.set(p,[h]),a.push(h),c+=d.length/4),o.push(h)}if(c>t)throw RangeError(`Vector clip storage exceeds texture capacity.`);for(let e of a){let r=e.edges.length/4,i=n.cells&&!e.rectangle?wn(e.edges):null,a=t-c+r;if(i&&Tn(i)<=a){e.cells=i,c+=Tn(i)-r;continue}let o=e.rectangle?null:Sn(e.edges),s=o?1+o.counts.length+o.entries-r:0;if(o&&c+s<=t){e.bands=o,c+=s;continue}let l=i?En(i,a):null;l&&(e.cells=l,e.coarsened=!0,c+=Tn(l)-r)}let l=new Float32Array(Math.max(1,c)*4),u=e.length;for(let e of a){let{edges:t,bands:n,cells:r}=e;if(e.offset=u,r){u=kn(l,u,r);continue}if(!n){l.set(t,u*4),u+=t.length/4;continue}let i=n.counts.length,a=u+1;l.set([a,n.minY,n.height,i],u*4),u=a+i;for(let e=0;e<i;e++){let t=n.counts[e];l.set([u,t,0,0],(a+e)*4),n.counts[e]=u,u+=t}for(let e=0;e<t.length;e+=4){let r=t[e+1],a=t[e+3],o=Math.max(0,xn(Math.min(r,a),n.minY,n.height,i)-1),s=Math.min(i-1,xn(Math.max(r,a),n.minY,n.height,i)+1);for(let r=o;r<=s;r++){let i=n.counts[r]++*4;for(let n=0;n<4;n++)l[i+n]=t[e+n]}}}for(let t=0;t<e.length;t++){let n=o[t];l.set([i[t],n.offset,n.rectangle?-1:e[t].edges.length/4,e[t].fillRule+(n.bands?2:0)+(n.cells?4:0)],t*4)}return n.onStats&&n.onStats({uniquePayloads:a.length,sharedPayloads:e.length-a.length,rectangleNodes:o.filter(e=>e.rectangle).length,cellIndexedNodes:o.filter(e=>e.cells).length,bandIndexedNodes:o.filter(e=>e.bands).length,unindexedPolygonNodes:o.filter(e=>!e.rectangle&&!e.cells&&!e.bands).length,coarsenedCellNodes:o.filter(e=>e.coarsened).length}),l}function kn(e,t,n){let r=t+2,i=r+n.levels.length,a=i+n.cellCount,o=a+n.pieceCount;return e.set([r,n.levels.length,n.cellSize,n.levelStep],t*4),e.set([n.originX,n.originY,0,0],(t+1)*4),n.levels.forEach((t,n)=>{e.set([i,t.columns,t.rows,0],(r+n)*4);let s=a,c=o;for(let n=0;n<t.columns*t.rows;n++)e.set([s+t.cells[n*4],t.cells[n*4+1],c+t.cells[n*4+2],t.cells[n*4+3]],i*4),i++;for(let n=0;n<t.pieces.length;n+=8)e.set([t.pieces[n],t.pieces[n+1],t.pieces[n+4],t.pieces[n+5]],a*4),a++;e.set(t.closures,o*4),o+=t.closures.length/4}),o}function An(e,t,n,r,i,a,o){if(r===0)return;let s=e[e.length-1];s?.kind===t&&s.clipIndex===i&&s.blendMode===a&&s.optionalContent===o&&s.first+s.count===n?s.count+=r:e.push({kind:t,first:n,count:r,...i===void 0?{}:{clipIndex:i},...a?{blendMode:a}:{},...o===void 0?{}:{optionalContent:o}})}function jn(e,t){return e!==void 0&&e.kind===t.kind&&e.clipIndex===t.clipIndex&&e.blendMode===t.blendMode&&e.first+e.count===t.first}function Mn(e){let t=[];e.rasterLayers.forEach((e,n)=>t.push({kind:`raster`,first:n,page:e.pageIndex??0,order:e.paintOrder??n}));for(let n=0;n<e.gradientFillPathCount;n++)t.push({kind:`gradient-fill`,first:n,page:e.gradientFillPaintMeta[n*4+3],order:e.gradientFillPaintMeta[n*4+2]});for(let n=0;n<e.gradientStrokeRunCount;n++)t.push({kind:`gradient-stroke`,first:n,page:e.gradientStrokeRunMetaB[n*4+1],order:e.gradientStrokeRunMetaB[n*4]});t.sort((e,t)=>e.page-t.page||e.order-t.order);let n=[];for(let e of t)An(n,e.kind,e.first,1);return An(n,`fill`,0,e.fillPathCount),An(n,`stroke`,0,e.segmentCount),An(n,`text`,0,e.textInstanceCount),n}function Nn(e){if(fn(e),e.drawRuns===void 0){if(e.clipPaths?.length)throw Error(`Vector clipping requires ordered draw runs.`);return}if(!Array.isArray(e.drawRuns))throw Error(`Invalid vector draw runs.`);let t={fill:e.fillPathCount,stroke:e.segmentCount,text:e.textInstanceCount,raster:e.rasterLayers.length,"gradient-fill":e.gradientFillPathCount,"gradient-stroke":e.gradientStrokeRunCount},n=new Map;for(let r of e.drawRuns){if(!r||!Object.hasOwn(t,r.kind)||!Number.isSafeInteger(r.first)||r.first<0||!Number.isSafeInteger(r.count)||r.count<=0||r.first+r.count>t[r.kind])throw Error(`Vector draw run is outside its instance store.`);if(r.optionalContent!==void 0&&(!Number.isSafeInteger(r.optionalContent)||r.optionalContent<0||r.optionalContent>=(e.optionalContent?.conditions.length??0)))throw Error(`Invalid optional-content draw condition.`);if(r.blendMode!==void 0&&r.blendMode!==`Multiply`)throw Error(`Invalid vector blend mode.`);if(r.blendMode&&r.kind.startsWith(`gradient-`))throw Error(`Gradient draw runs do not support Multiply blending.`);if(r.clipIndex!==void 0&&(!Number.isSafeInteger(r.clipIndex)||r.clipIndex<0||r.clipIndex>=(e.clipPaths?.length??0)))throw Error(`Invalid draw-run clip reference.`);let i=n.get(r.kind)??[];i.push(r),n.set(r.kind,i)}for(let[e,r]of Object.entries(t)){let t=0;for(let r of(n.get(e)??[]).sort((e,t)=>e.first-t.first)){if(r.first!==t)throw Error(`Vector draw runs overlap or omit visible content.`);t+=r.count}if(t!==r)throw Error(`Vector draw runs do not cover their instance store.`)}}function Pn(e){Nn(e),!e.clipPaths?.length&&e.drawRuns&&JSON.stringify(e.drawRuns)===JSON.stringify(Mn(e))&&delete e.drawRuns}var Fn=Object.freeze([`stroke`,`fill`,`text`,`raster`,`gradient-fill`,`gradient-stroke`]),In=Object.freeze({items:1e6,ranges:4e6,elements:262144,userProperties:1e6,text:16e6});function Ln(e,t){switch(t){case`stroke`:return e.segmentCount;case`fill`:return e.fillPathCount;case`text`:return e.textInstanceCount;case`raster`:return e.rasterLayers.length;case`gradient-fill`:return e.gradientFillPathCount;case`gradient-stroke`:return e.gradientStrokeRunCount}}var Rn=class{pending=new Map;add(e,t,n,r){if(n<=0||r<0)return;let i=this.pending.get(e);i||this.pending.set(e,i=[]);let a=i.length-3;a>=0&&i[a+2]===r&&i[a]+i[a+1]===t?i[a+1]+=n:i.push(t,n,r)}get isEmpty(){return this.pending.size===0}build(){let e={};for(let[t,n]of this.pending){let r=Array.from({length:n.length/3},(e,t)=>t).sort((e,t)=>n[e*3]-n[t*3]),i=[];for(let e of r){let t=n[e*3],r=n[e*3+1],a=n[e*3+2],o=i.length-3,s=o>=0?i[o]+i[o+1]:0,c=Math.max(t,s);c>=t+r||(o>=0&&i[o+2]===a&&s===c?i[o+1]+=t+r-c:i.push(c,t+r-c,a))}e[t]=Uint32Array.from(i)}return e}};function zn(e,t){let n=e.markedContent?.ranges[t.kind];if(!n?.length)return-1;let r=0,i=n.length/3;for(;r<i;){let e=r+i>>>1;n[e*3]<=t.index?r=e+1:i=e}let a=r-1;return a<0||t.index>=n[a*3]+n[a*3+1]?-1:n[a*3+2]}function Bn(e,t){let n=zn(e,t);return n<0?void 0:e.markedContent.items[n]}function Vn(e,t){let n=e.markedContent;if(!n)return;let r=[],i=new Map,a=new Rn;for(let o of Fn){let s=t[o];for(let t=0;t<s.length;t++){let c=zn(e,{kind:o,index:s[t]});if(c<0)continue;let l=i.get(c);l===void 0&&(l=r.length,i.set(c,l),r.push({...n.items[c],pageIndex:0})),a.add(o,t,1,l)}}return r.length?{items:r,ranges:a.build()}:void 0}var Hn=new WeakMap;function Un(e,t){let n=e.structureElements;if(!n)return;let r=Hn.get(n);return r||Hn.set(n,r=new Map(n.map(e=>[e.id,e]))),r.get(t)}function Wn(e){let t=()=>{throw Error(`Invalid structure metadata.`)},n={length:0},r=(e,r=!1)=>{e===void 0&&r||(typeof e!=`string`||(n.length+=e.length)>In.text)&&t()},i=e=>Number.isSafeInteger(e)&&e>=0,a=e=>((!e||typeof e!=`object`||Array.isArray(e))&&t(),e),o=new Set;if(e.structureElements!==void 0){(!Array.isArray(e.structureElements)||e.structureElements.length>In.elements)&&t();let n=0;for(let i of e.structureElements){let e=a(i);r(e.id),r(e.type),(!e.id||o.has(e.id))&&t(),o.add(e.id);for(let t of[`standardType`,`parentId`,`title`,`alt`,`actualText`,`expansion`,`lang`,`elementId`])r(e[t],!0);if(e.userProperties!==void 0){(!Array.isArray(e.userProperties)||(n+=e.userProperties.length)>In.userProperties)&&t();for(let n of e.userProperties){let e=a(n);r(e.name),r(e.formattedValue,!0);let i=e.value;typeof i==`string`?r(i):i!==null&&typeof i!=`boolean`&&(typeof i!=`number`||!Number.isFinite(i))&&t(),e.hidden!==void 0&&typeof e.hidden!=`boolean`&&t()}}}}let s=e.markedContent;if(s===void 0)return;let{items:c,ranges:l}=a(s);(!Array.isArray(c)||c.length>In.items||!l||typeof l!=`object`)&&t();for(let n of c){let s=a(n);(!i(s.pageIndex)||s.pageIndex>=e.pageCount||!i(s.sourcePageIndex)||!i(s.mcid))&&t(),r(s.tag),s.elementId!==void 0&&(typeof s.elementId!=`string`||!o.has(s.elementId))&&t()}let u=0;for(let[n,r]of Object.entries(l)){(!Fn.includes(n)||!(r instanceof Uint32Array)||r.length%3!=0||(u+=r.length/3)>In.ranges)&&t();let i=Ln(e,n),a=0;for(let e=0;e<r.length;e+=3){let n=r[e],o=r[e+1],s=r[e+2];(n<a||o===0||n+o>i||s>=c.length)&&t(),a=n+o}}}function Gn(e){if(!e.some(({scene:e})=>e.markedContent?.items.length||e.structureElements?.length))return{droppedPages:0};let t=[],n=new Map,r=new Map,i=0,a=0;for(let{scene:o,offsets:s}of e){let e=Object.values(o.markedContent?.ranges??{}).reduce((e,t)=>e+t.length/3,0),c=(o.structureElements??[]).filter(e=>!r.has(e.id)).length;if(t.length+(o.markedContent?.items.length??0)>In.items||i+e>In.ranges||r.size+c>In.elements){o.markedContent?.items.length&&a++;continue}i+=e;let l=t.length;for(let e of o.markedContent?.items??[])t.push({...e,pageIndex:s.pageRectBase+e.pageIndex});for(let[e,t]of Object.entries(o.markedContent?.ranges??{})){let r=new Uint32Array(t.length);for(let n=0;n<t.length;n+=3)r[n]=t[n]+s.primitives[e],r[n+1]=t[n+1],r[n+2]=t[n+2]+l;let i=n.get(e);i||n.set(e,i=[]),i.push(r)}for(let e of o.structureElements??[])r.has(e.id)||r.set(e.id,e)}let o={};for(let[e,t]of n){let n=new Uint32Array(t.reduce((e,t)=>e+t.length,0)),r=0;for(let e of t)n.set(e,r),r+=e.length;o[e]=n}return{...t.length?{markedContent:{items:t,ranges:o}}:{},...r.size?{structureElements:[...r.values()]}:{},droppedPages:a}}var Kn=1024,qn=new Float32Array,Jn=new Uint8Array;function Yn(e){let t=e;return{gradientCount:er(t.gradientCount),gradientMetaA:B(t.gradientMetaA),gradientMetaB:B(t.gradientMetaB),gradientMetaC:B(t.gradientMetaC),gradientMetaD:B(t.gradientMetaD),gradientMetaE:B(t.gradientMetaE),gradientLut:nr(t.gradientLut),gradientMeshRanges:t.gradientMeshRanges,gradientMeshPositions:t.gradientMeshPositions,gradientMeshColors:t.gradientMeshColors,gradientMeshIndices:t.gradientMeshIndices,gradientFillPathCount:er(t.gradientFillPathCount),gradientFillSegmentCount:er(t.gradientFillSegmentCount),gradientFillPathMetaA:B(t.gradientFillPathMetaA),gradientFillPathMetaB:B(t.gradientFillPathMetaB),gradientFillPathMetaC:B(t.gradientFillPathMetaC),gradientFillPaintMeta:B(t.gradientFillPaintMeta),gradientFillSegmentsA:B(t.gradientFillSegmentsA),gradientFillSegmentsB:B(t.gradientFillSegmentsB),gradientStrokeRunCount:er(t.gradientStrokeRunCount),gradientStrokeSegmentCount:er(t.gradientStrokeSegmentCount),gradientStrokeRunMetaA:B(t.gradientStrokeRunMetaA),gradientStrokeRunMetaB:B(t.gradientStrokeRunMetaB),gradientStrokeEndpoints:B(t.gradientStrokeEndpoints),gradientStrokePrimitiveMeta:B(t.gradientStrokePrimitiveMeta),gradientStrokePrimitiveBounds:B(t.gradientStrokePrimitiveBounds),gradientStrokeStyles:B(t.gradientStrokeStyles)}}function Xn(e,t){let n=[];for(let t=0;t<e.length;t+=1){let r=e[t];n.push({kind:`raster`,index:t,paintOrder:tr(r.paintOrder,t),pageIndex:er(r.pageIndex)})}for(let e=0;e<t.gradientFillPathCount;e+=1){let r=e*4;n.push({kind:`gradient-fill`,index:e,paintOrder:tr(t.gradientFillPaintMeta[r+2],e),pageIndex:er(t.gradientFillPaintMeta[r+3])})}for(let e=0;e<t.gradientStrokeRunCount;e+=1){let r=e*4;n.push({kind:`gradient-stroke`,index:e,paintOrder:tr(t.gradientStrokeRunMetaB[r],e),pageIndex:er(t.gradientStrokeRunMetaB[r+1])})}return n.sort((e,t)=>{let n=e.pageIndex-t.pageIndex;if(n!==0)return n;let r=e.paintOrder-t.paintOrder;if(r!==0)return r;let i=$n(e.kind)-$n(t.kind);return i===0?e.index-t.index:i}),n}function Zn(e){let t=new Set;for(let n of e){if(n.kind===`raster`){if(t.has(n.pageIndex))return!0;continue}t.add(n.pageIndex)}return!1}function Qn(e,t,n,r){let i=e&&t;return{splitOrderedGradientPrefix:i,includeGradientPaint:!i,hasMinifiableContent:i?n:r}}function $n(e){return e===`raster`?0:e===`gradient-fill`?1:2}function er(e){let t=Number(e);return Number.isFinite(t)?Math.max(0,Math.trunc(t)):0}function tr(e,t){let n=Number(e);return Number.isFinite(n)?n:t}function B(e){return e instanceof Float32Array?e:qn}function nr(e){return e instanceof Uint8Array?e:Jn}var rr=`
vec2 heprGradientParameter(vec4 a, vec4 c, vec4 d, vec2 point) {
  int flags = int(a.z + 0.5);
  vec2 axis = d.xy - c.zw;
  vec2 offset = point - c.zw;
  if (a.x < 0.5) {
    float denominator = dot(axis, axis);
    if (denominator <= 1e-12) return vec2(0.0);
    float t = dot(offset, axis) / denominator;
    bool valid = (t >= 0.0 || (flags & 1) == 0) && (t <= 1.0 || (flags & 2) == 0);
    return vec2(t, valid ? 1.0 : 0.0);
  }
  float delta = d.w - d.z;
  float qa = dot(axis, axis) - delta * delta;
  float qb = -2.0 * (dot(offset, axis) + d.z * delta);
  float qc = dot(offset, offset) - d.z * d.z;
  float t0 = -1e20;
  float t1 = -1e20;
  if (abs(qa) <= 1e-10) {
    if (abs(qb) <= 1e-10) return vec2(0.0);
    t0 = -qc / qb;
  } else {
    float discriminant = qb * qb - 4.0 * qa * qc;
    if (discriminant < 0.0) return vec2(0.0);
    float root = sqrt(max(discriminant, 0.0));
    t0 = (-qb - root) / (2.0 * qa);
    t1 = (-qb + root) / (2.0 * qa);
  }
  bool valid0 = t0 > -1e19 && d.z + t0 * delta >= 0.0 &&
    (t0 >= 0.0 || (flags & 1) == 0) && (t0 <= 1.0 || (flags & 2) == 0);
  bool valid1 = t1 > -1e19 && d.z + t1 * delta >= 0.0 &&
    (t1 >= 0.0 || (flags & 1) == 0) && (t1 <= 1.0 || (flags & 2) == 0);
  if (!valid0 && !valid1) return vec2(0.0);
  return vec2(valid0 && (!valid1 || t0 >= t1) ? t0 : t1, 1.0);
}
`,ir=`
fn heprGradientParameter(a: vec4f, c: vec4f, d: vec4f, point: vec2f) -> vec2f {
  let flags = i32(a.z + 0.5);
  let axis = d.xy - c.zw;
  let offset = point - c.zw;
  if (a.x < 0.5) {
    let denominator = dot(axis, axis);
    if (denominator <= 1e-12) { return vec2f(0.0); }
    let t = dot(offset, axis) / denominator;
    let valid = (t >= 0.0 || (flags & 1) == 0) && (t <= 1.0 || (flags & 2) == 0);
    return vec2f(t, select(0.0, 1.0, valid));
  }
  let delta = d.w - d.z;
  let qa = dot(axis, axis) - delta * delta;
  let qb = -2.0 * (dot(offset, axis) + d.z * delta);
  let qc = dot(offset, offset) - d.z * d.z;
  var t0 = -1e20;
  var t1 = -1e20;
  if (abs(qa) <= 1e-10) {
    if (abs(qb) <= 1e-10) { return vec2f(0.0); }
    t0 = -qc / qb;
  } else {
    let discriminant = qb * qb - 4.0 * qa * qc;
    if (discriminant < 0.0) { return vec2f(0.0); }
    let root = sqrt(max(discriminant, 0.0));
    t0 = (-qb - root) / (2.0 * qa);
    t1 = (-qb + root) / (2.0 * qa);
  }
  let valid0 = t0 > -1e19 && d.z + t0 * delta >= 0.0 &&
    (t0 >= 0.0 || (flags & 1) == 0) && (t0 <= 1.0 || (flags & 2) == 0);
  let valid1 = t1 > -1e19 && d.z + t1 * delta >= 0.0 &&
    (t1 >= 0.0 || (flags & 1) == 0) && (t1 <= 1.0 || (flags & 2) == 0);
  if (!valid0 && !valid1) { return vec2f(0.0); }
  return vec2f(select(t1, t0, valid0 && (!valid1 || t0 >= t1)), 1.0);
}
`,ar=`
vec4 heprGradientBackground(float encoded) {
  if (encoded < 0.5) return vec4(0.0);
  int rgb = int(encoded) - 1;
  return vec4(float((rgb >> 16) & 255), float((rgb >> 8) & 255), float(rgb & 255), 255.0) / 255.0;
}
`,or=`
fn heprGradientBackground(encoded: f32) -> vec4f {
  if (encoded < 0.5) { return vec4f(0.0); }
  let rgb = i32(encoded) - 1;
  return vec4f(f32((rgb >> 16) & 255), f32((rgb >> 8) & 255), f32(rgb & 255), 255.0) / 255.0;
}
`;function sr(e,t,n,r,i){if(t<0)return 1;if(t>=e.gradientCount)return 0;let a=t*4,o=e.gradientMetaA,s=e.gradientMetaB,c=e.gradientMetaC,l=e.gradientMetaD,u=e.gradientMetaE,d=s[a]*n+s[a+2]*r+c[a],f=s[a+1]*n+s[a+3]*r+c[a+1];if(o[a+1]>=.5&&(d<u[a]||f<u[a+1]||d>u[a+2]||f>u[a+3]))return 0;if(o[a]===2){let n=Nt(e,t,d,f,i);if(n!==null)return n;let r=o[a+3];return r<.5?0:i===3?1:(r-1>>>(2-i)*8&255)/255}let p=d-c[a+2],m=f-c[a+3],h=l[a]-c[a+2],g=l[a+1]-c[a+3],_=Math.round(o[a+2]),v=e=>Number.isFinite(e)&&(e>=0||!(_&1))&&(e<=1||!(_&2)),y=NaN;if(o[a]<.5){let e=h*h+g*g;e>1e-12&&(y=(p*h+m*g)/e),v(y)||(y=NaN)}else{let e=l[a+2],t=l[a+3]-e,n=h*h+g*g-t*t,r=-2*(p*h+m*g+e*t),i=p*p+m*m-e*e,o=NaN,s=NaN;if(Math.abs(n)<=1e-10)Math.abs(r)>1e-10&&(o=-i/r);else{let e=r*r-4*n*i;if(e>=0){let t=Math.sqrt(e);o=(-r-t)/(2*n),s=(-r+t)/(2*n)}}v(o)&&e+o*t>=0&&(y=o),v(s)&&e+s*t>=0&&(!Number.isFinite(y)||s>y)&&(y=s)}if(!Number.isFinite(y)){let e=o[a+3];return e<.5?0:i===3?1:(e-1>>>(2-i)*8&255)/255}let b=Math.max(0,Math.min(1,y))*(Kn-1),x=Math.floor(b),S=b-x,C=t*Kn*4,w=e.gradientLut[C+x*4+i],T=e.gradientLut[C+Math.min(x+1,Kn-1)*4+i];return(w*(1-S)+T*S)/255}var cr=[`stroke`,`fill`,`text`,`raster`,`gradient-fill`,`gradient-stroke`],lr=.001,ur=134217728,dr=1024,fr=.05;function pr(e){return[e.segmentCount,e.fillPathCount,e.textInstanceCount,e.rasterLayers.length,e.gradientFillPathCount,e.gradientStrokeRunCount]}function mr(e,t){let n=t?cr.indexOf(t.kind):-1;if(n<0||!Number.isSafeInteger(t.index)||t.index<0||t.index>=pr(e)[n])throw RangeError(`Primitive reference is outside the loaded scene.`)}var hr=new WeakMap,gr=new WeakMap,_r=new WeakMap;function vr(e){let t=hr.get(e);if(!t){let n=e.paintGraph?s(e):e.drawRuns??Mn(e),r=new Map;for(let e of n){let t=r.get(e.kind);t||r.set(e.kind,t=[]),t.push(e)}for(let e of r.values())e.sort((e,t)=>e.first-t.first);t={runs:n,byKind:r},hr.set(e,t)}return t}function yr(e,t){let n=vr(e).byKind.get(t.kind)??[],r=n[Dr(n,t.index)];return r&&t.index<r.first+r.count?r:void 0}function br(e){let t=gr.get(e);if(!t){let n=new Map;if(!i(e.optionalContent).size)return gr.set(e,n),n;let r=e.paintGraph?s(e):e.drawRuns??Mn(e);for(let t of r){if(!t.count||!c(e,t,()=>!0))continue;let r=xr(e,t);if(r===void 0)continue;let i=n.get(r);i||n.set(r,i=[]),i.push(t)}gr.set(e,t=n)}return t}function xr(e,n){let r=i(e.optionalContent);if(!r.size)return;let a=_r.get(e);a||_r.set(e,a=new Map);let o=t=>{if(a.has(t))return a.get(t);let n=e.optionalContent?.conditions[t],i=n?.kind===`group`?r.get(n.groupId):n?.kind===`not`?o(n.operand):n?.kind===`and`||n?.kind===`or`?n.operands.map(o).find(e=>e!==void 0):void 0;return a.set(t,i),i};return t(e,n,!1).map(o).find(e=>e!==void 0)}function Sr(e,t){return Gr(e,t)}function Cr(e,t){mr(e,t);let n=Bn(e,t);return n&&{...n}}function wr(e,n){mr(e,n);let r=yr(e,n)?.optionalContent??null,a=i(e.optionalContent),o=new Set,s=new Set,c=t(e,yr(e,n)),l=xr(e,yr(e,n));for(;c.length;){let t=c.pop();if(s.has(t))continue;s.add(t);let n=e.optionalContent?.conditions[t];n?.kind===`group`?a.get(n.groupId)===void 0&&o.add(n.groupId):n?.kind===`not`?c.push(n.operand):(n?.kind===`and`||n?.kind===`or`)&&c.push(...n.operands)}let u=Bn(e,n);return{optionalContent:{conditionId:r,layerIds:[...o]},...l===void 0?{}:{annotationId:l},...u?{markedContent:{...u}}:{}}}function Tr(e,t){return yr(e,t)?.optionalContent}function Er(e,t,n){return c(e,yr(e,t),n)}function Dr(e,t){let n=0,r=e.length;for(;n<r;){let i=n+r>>>1;e[i].first<=t?n=i+1:r=i}return n-1}function Or(e,t){mr(e,t);let n;if(t.kind===`stroke`&&(n=Ar(e.primitiveMeta,e.primitiveBounds,t.index)),t.kind===`text`){let r=Math.round(e.textInstanceB[t.index*4+3])-1;r>=0&&e.textClipRects&&(n=Nr(e.textClipRects,r*4))}return{clipIndex:yr(e,t)?.clipIndex??-1,...n?{rect:n}:{}}}function kr(e,t,n){mr(e,t);let r=Vr(e,t);return Hr(n,r.count),t.kind===`gradient-stroke`?Ar(e.gradientStrokePrimitiveMeta,e.gradientStrokePrimitiveBounds,r.first+n):Or(e,t).rect}function Ar(e,t,n){return jr(e[n*4+3])&4?Nr(t,n*4):void 0}function jr(e){return Math.floor(e/2+1e-6)}function Mr(e){return Math.max(0,Math.min(1,e-jr(e)*2))}function Nr(e,t){return{minX:e[t],minY:e[t+1],maxX:e[t+2],maxY:e[t+3]}}function Pr(){return{minX:1/0,minY:1/0,maxX:-1/0,maxY:-1/0}}function Fr(e,t,n=0){e.minX=Math.min(e.minX,t.x-n),e.minY=Math.min(e.minY,t.y-n),e.maxX=Math.max(e.maxX,t.x+n),e.maxY=Math.max(e.maxY,t.y+n)}function Ir(e,t){return e.x>=t.minX&&e.x<=t.maxX&&e.y>=t.minY&&e.y<=t.maxY}function Lr(e){return!!e&&Number.isFinite(e.x)&&Number.isFinite(e.y)}function Rr(e,t){return{x:t[0]*e.x+t[2]*e.y+t[4],y:t[1]*e.x+t[3]*e.y+t[5]}}function zr(e,t){let n=t[0]*t[3]-t[1]*t[2];if(!Number.isFinite(n)||Math.abs(n)<1e-20)return null;let r=e.x-t[4],i=e.y-t[5];return{x:(t[3]*r-t[2]*i)/n,y:(t[0]*i-t[1]*r)/n}}function Br(e,t){let n=t*4;return[e.textInstanceA[n],e.textInstanceA[n+1],e.textInstanceA[n+2],e.textInstanceA[n+3],e.textInstanceB[n],e.textInstanceB[n+1]]}function Vr(e,t){let n=t.index*4;switch(t.kind){case`stroke`:return{a:e.endpoints,b:e.primitiveMeta,first:t.index,count:1};case`gradient-stroke`:return{a:e.gradientStrokeEndpoints,b:e.gradientStrokePrimitiveMeta,first:Math.round(e.gradientStrokeRunMetaA[n]),count:Math.round(e.gradientStrokeRunMetaA[n+1])};case`fill`:return{a:e.fillSegmentsA,b:e.fillSegmentsB,first:Math.round(e.fillPathMetaA[n]),count:Math.round(e.fillPathMetaA[n+1])};case`gradient-fill`:return{a:e.gradientFillSegmentsA,b:e.gradientFillSegmentsB,first:Math.round(e.gradientFillPathMetaA[n]),count:Math.round(e.gradientFillPathMetaA[n+1])};case`text`:{let r=Math.round(e.textInstanceB[n+2])*4;return{a:e.textGlyphSegmentsA,b:e.textGlyphSegmentsB,first:Math.round(e.textGlyphMetaA[r]),count:Math.round(e.textGlyphMetaA[r+1]),matrix:Br(e,t.index)}}case`raster`:return{a:e.endpoints,b:e.primitiveMeta,first:0,count:4}}}function Hr(e,t){if(!Number.isSafeInteger(e)||e<0||e>=t)throw RangeError(`Primitive segment index is out of range.`)}function Ur(e,t){let n=(e.first+t)*4,r={x:e.a[n],y:e.a[n+1]},i={x:e.b[n],y:e.b[n+1]},a=e.b[n+2]>=.5?{x:e.a[n+2],y:e.a[n+3]}:void 0;return{start:e.matrix?Rr(r,e.matrix):r,end:e.matrix?Rr(i,e.matrix):i,...a?{control:e.matrix?Rr(a,e.matrix):a}:{}}}function Wr(e,t,n){return[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}].map(r=>Rr(r,(n??e.rasterLayers[t]).matrix))}function Gr(e,t){let n=t.index*4;if(t.kind===`fill`||t.kind===`gradient-fill`){let r=t.kind===`fill`?e.fillPathMetaA:e.gradientFillPathMetaA,i=t.kind===`fill`?e.fillPathMetaB:e.gradientFillPathMetaB;return{minX:r[n+2],minY:r[n+3],maxX:i[n],maxY:i[n+1]}}let r=Pr();if(t.kind===`raster`){let n=l(e,t.index);if(n)return{...n};for(let n of Wr(e,t.index))Fr(r,n)}else if(t.kind===`text`){let i=Math.round(e.textInstanceB[n+2])*4,a=Br(e,t.index);for(let t of[e.textGlyphMetaA[i+2],e.textGlyphMetaB[i]])for(let n of[e.textGlyphMetaA[i+3],e.textGlyphMetaB[i+1]])Fr(r,Rr({x:t,y:n},a))}else{let n=Vr(e,t),i=t.kind===`stroke`?e.styles:e.gradientStrokeStyles;for(let e=0;e<n.count;e++){let t=Ur(n,e),a=Math.max(0,i[(n.first+e)*4]);Fr(r,t.start,a),Fr(r,t.end,a),t.control&&Fr(r,t.control,a)}}return r}function Kr(e,t,n){if(t.kind===`raster`)return e.rasterLayers[t.index].pageIndex;if(t.kind===`gradient-fill`)return e.gradientFillPaintMeta[t.index*4+3];if(t.kind===`gradient-stroke`)return e.gradientStrokeRunMetaB[t.index*4+1];if(t.kind===`text`){for(let n=0;n<e.pageTextRanges.length;n+=2)if(t.index>=e.pageTextRanges[n]&&t.index<e.pageTextRanges[n]+e.pageTextRanges[n+1])return n/2}let r=null;for(let t=0;t<e.pageRects.length;t+=4){let i=Nr(e.pageRects,t);if(!(n.maxX<i.minX||n.minX>i.maxX||n.maxY<i.minY||n.minY>i.maxY)){if(r!==null)return null;r=t/4}}return r}function qr(e,t){mr(e,t);let n={...t},r=n.index*4,i=Vr(e,n),a=null,o=1,s;if(n.kind===`stroke`||n.kind===`gradient-stroke`){let t=n.kind===`stroke`?e.styles:e.gradientStrokeStyles,s=i.first*4;a=[t[s+1],t[s+2],t[s+3]],o=i.count?Mr(i.b[s+3]):0;for(let e=1;e<i.count;e++){let n=(i.first+e)*4;a&&a.some((e,r)=>e!==t[n+r+1])&&(a=null),o!==Mr(i.b[n+3])&&(o=null)}n.kind===`gradient-stroke`&&e.gradientStrokeRunMetaA[r+2]>=0&&(a=null)}else if(n.kind===`fill`||n.kind===`gradient-fill`){let t=n.kind===`fill`?e.fillPathMetaB:e.gradientFillPathMetaB,i=n.kind===`fill`?e.fillPathMetaC:e.gradientFillPathMetaC;a=[t[r+2],t[r+3],i[r+2]],o=i[r+3],s=i[r]>=.5?`evenodd`:`nonzero`,n.kind===`gradient-fill`&&e.gradientFillPaintMeta[r]>=0&&(a=null)}else n.kind===`text`&&(a=[e.textInstanceC[r],e.textInstanceC[r+1],e.textInstanceC[r+2]],o=e.textInstanceC[r+3],s=`nonzero`);n.kind===`raster`&&(o=e.rasterLayers[n.index].opacity??1);let c=Gr(e,n),l=n.kind===`raster`?Wr(e,n.index):void 0,u=n.kind===`gradient-fill`?e.gradientFillPaintMeta:n.kind===`gradient-stroke`?e.gradientStrokeRunMetaA:void 0,d=n.kind===`gradient-stroke`?2:0,f=u&&u[r+d]>=0?u[r+d]:null,p=u&&u[r+d+1]>=0?u[r+d+1]:null,m=f===null?void 0:e.gradientMetaA[f*4]===2?`mesh`:e.gradientMetaA[f*4]===1?`radial`:`axial`;return{ref:{...n},...wr(e,n),kind:n.kind,index:n.index,bounds:c,pageIndex:Kr(e,n,c),color:a,opacity:o,segmentCount:i.count,...s?{fillRule:s}:{},...u?{gradientIndex:f,maskGradientIndex:p}:{},...m?{shadingKind:m}:{},...m===`mesh`?{triangleCount:jt(e,f),getTriangle:t=>Mt(e,f,t)}:{},...n.kind===`stroke`?{strokeWidth:2*e.styles[r]}:{},...l?{quad:l,width:e.rasterLayers[n.index].width,height:e.rasterLayers[n.index].height}:{},getSegment(e){return Hr(e,i.count),l?{start:{...l[e]},end:{...l[(e+1)%4]}}:Ur(i,e)},getSegmentStyle(t){Hr(t,i.count);let a=kr(e,n,t),o=a?{clipBounds:a}:{};if(n.kind===`stroke`||n.kind===`gradient-stroke`){let r=n.kind===`stroke`?e.styles:e.gradientStrokeStyles,a=(i.first+t)*4,s=i.b[a+3],c=jr(s);return{color:f===null?[r[a+1],r[a+2],r[a+3]]:null,opacity:Mr(s),strokeWidth:2*r[a],hairline:!!(c&1),roundCap:!!(c&2),...o}}if(n.kind===`fill`||n.kind===`gradient-fill`){let t=n.kind===`fill`?e.fillPathMetaB:e.gradientFillPathMetaB,i=n.kind===`fill`?e.fillPathMetaC:e.gradientFillPathMetaC;return{color:f===null?[t[r+2],t[r+3],i[r+2]]:null,opacity:i[r+3],...o}}return n.kind===`text`?{color:[e.textInstanceC[r],e.textInstanceC[r+1],e.textInstanceC[r+2]],opacity:e.textInstanceC[r+3],...o}:{color:null,opacity:e.rasterLayers[n.index].opacity??1,...o}}}}function Jr(e,t,n){return e.y>n.y==t.y>n.y?0:e.x+(n.y-e.y)/(t.y-e.y)*(t.x-e.x)>n.x?t.y>e.y?1:-1:0}function Yr(e,t){if(!e.control)return{x:e.start.x+(e.end.x-e.start.x)*t,y:e.start.y+(e.end.y-e.start.y)*t};let n=1-t;return{x:n*n*e.start.x+2*n*t*e.control.x+t*t*e.end.x,y:n*n*e.start.y+2*n*t*e.control.y+t*t*e.end.y}}function Xr(e,t){if(!e.control)return Jr(e.start,e.end,t);let n=e.start.y-2*e.control.y+e.end.y,r=2*(e.control.y-e.start.y),i=Zr(n,r,e.start.y-t.y),a=0;for(let o of i)if(o>=0&&o<1&&Yr(e,o).x>t.x){let e=2*n*o+r;Math.abs(e)>1e-12&&(a+=e>0?1:-1)}return a}function Zr(e,t,n){if(Math.abs(e)<=1e-14*Math.max(1,Math.abs(t)))return Math.abs(t)>1e-20?[-n/t]:[];let r=t*t-4*e*n;if(r<0)return[];let i=Math.sqrt(r);if(i===0)return[-t/(2*e)];let a=-.5*(t+(t<0?-i:i));return[a/e,n/a]}function Qr(e,t,n,r){if(r&&!Ir(t,r))return!1;for(let r=0;n>=0;r++){let i=e.clipPaths?.[n];if(!i||r>=64)return!1;let a=0;for(let e=0;e<i.edges.length;e+=4)a+=Jr({x:i.edges[e],y:i.edges[e+1]},{x:i.edges[e+2],y:i.edges[e+3]},t);if(i.fillRule?Math.abs(a)%2==0:a===0)return!1;n=i.parent}return!0}function $r(e,t,n){return sr(e,t,n.x,n.y,3)}function ei(e,t,n,r){let i=r??e.rasterLayers[t],a=zr(n,i.matrix);if(!a||a.x<0||a.y<0||a.x>1||a.y>1||!i.width||!i.height)return 0;let o=a.x*i.width-.5,s=a.y*i.height-.5,c=Math.floor(o),l=Math.floor(s),u=(e,t)=>i.data[(Math.max(0,Math.min(i.height-1,t))*i.width+Math.max(0,Math.min(i.width-1,e)))*4+3]/255,d=o-c,f=s-l;return(i.opacity??1)*((u(c,l)*(1-d)+u(c+1,l)*d)*(1-f)+(u(c,l+1)*(1-d)+u(c+1,l+1)*d)*f)}function ti(e,t,n){let r=t.x-e.x,i=t.y-e.y,a=r*r+i*i,o=a?Math.max(0,Math.min(1,((n.x-e.x)*r+(n.y-e.y)*i)/a)):0;return{t:o,distance:Math.hypot(n.x-e.x-o*r,n.y-e.y-o*i)}}async function ni(e,t,n,r){let i=null,a=r??(t=>Yr(e,t)),o=async(s,c,l,u,d)=>{n.shouldYield()&&await n.yield();let f=(s+c)*.5,p=t.project(a(f));if(!Lr(l)||!Lr(u)||!Lr(p)){d<12&&(l||u||p)&&(await o(s,f,l,p,d+1),await o(f,c,p,u,d+1));return}let m=t.project(a((s+f)*.5)),h=t.project(a((f+c)*.5)),g=Math.max(ti(l,u,p).distance,Lr(m)?ti(l,u,m).distance:1/0,Lr(h)?ti(l,u,h).distance:1/0);if(d<16&&g>fr){await o(s,f,l,p,d+1),await o(f,c,p,u,d+1);return}let _=ti(l,u,t.clientPoint),v={x:l.x+(u.x-l.x)*_.t,y:l.y+(u.y-l.y)*_.t},y;if(!e.control&&!r)y=t.unproject(v)??a(s+(c-s)*_.t);else{let e=s,n=c;for(let r=0;r<18;r++){let r=e+(n-e)/3,i=n-(n-e)/3,o=t.project(a(r)),s=t.project(a(i));if(!o||!s)break;Math.hypot(o.x-t.clientPoint.x,o.y-t.clientPoint.y)<=Math.hypot(s.x-t.clientPoint.x,s.y-t.clientPoint.y)?n=i:e=r}let r=[s,c,(e+n)*.5],i=r[0],o=1/0;for(let e of r){let n=t.project(a(e)),r=n?Math.hypot(n.x-t.clientPoint.x,n.y-t.clientPoint.y):1/0;r<o&&(o=r,i=e)}y=a(i)}let b=t.project(y);if(!Lr(b))return;let x=Math.hypot(b.x-t.clientPoint.x,b.y-t.clientPoint.y);(!i||x<i.distance)&&(i={point:y,distance:x})};return await o(0,1,t.project(a(0)),t.project(a(1)),0),i}async function ri(e,t,n,r,i){if(t<=0)return i;let a=e.control?await ni(e,{...n,clientPoint:n.point,project:e=>e,unproject:e=>e},r):{distance:ti(e.start,e.end,n.point).distance};if(a&&a.distance<=t+1e-10)return{point:{...n.point},distance:0};let o=null,s=async(e,t=!1)=>{let i=await ni({start:e(0),end:e(1)},n,r,t?void 0:e);i&&(!o||i.distance<o.distance)&&(o=i)},c=t=>{let n=e.control,r=n?(1-t)*(n.x-e.start.x)+t*(e.end.x-n.x):e.end.x-e.start.x,i=n?(1-t)*(n.y-e.start.y)+t*(e.end.y-n.y):e.end.y-e.start.y,a=Math.hypot(r,i);return a<=1e-15&&(r=e.end.x-e.start.x,i=e.end.y-e.start.y,a=Math.hypot(r,i)),a?{x:r/a,y:i/a}:{x:1,y:0}};for(let n of[-1,1])await s(r=>{let i=Yr(e,r),a=c(r);return{x:i.x-a.y*t*n,y:i.y+a.x*t*n}},!e.control);let l=async e=>{for(let n=0;n<4;n++)await s(r=>{let i=(n+r)*Math.PI/2;return{x:e.x+t*Math.cos(i),y:e.y+t*Math.sin(i)}})};if(await l(e.start),(e.start.x!==e.end.x||e.start.y!==e.end.y)&&await l(e.end),e.control){let t=e.control.x-e.start.x,n=e.control.y-e.start.y,r=e.end.x-2*e.control.x+e.start.x,i=e.end.y-2*e.control.y+e.start.y,a=Math.abs(r)>=Math.abs(i)?-t/r:-n/i;a>0&&a<1&&Math.hypot(t+a*r,n+a*i)<=1e-10&&await l(Yr(e,a))}return o}var ii=class{operations=0;time=performance.now();check;progressOperations=0;nextProgressOperation=1/0;onProgress;constructor(e){this.check=e}setProgress(e,t){this.operations=0,this.progressOperations=e,this.nextProgressOperation=Math.ceil(e/100),this.onProgress=t}shouldYield(){if(this.check(),this.operations++,this.operations>=this.nextProgressOperation){let e=Math.min(99,Math.floor(this.operations*100/this.progressOperations));this.nextProgressOperation=e===99?1/0:Math.ceil((e+1)*this.progressOperations/100),this.onProgress?.(e),this.check()}return this.operations%dr===0&&performance.now()-this.time>=8}async yield(){this.check(),await new Promise(e=>setTimeout(e,0)),this.time=performance.now(),this.check()}};function ai(e){return e=(e|e<<8)&16711935,e=(e|e<<4)&252645135,e=(e|e<<2)&858993459,(e|e<<1)&1431655765}function oi(e,t){let n=cr.length-1;for(;n&&e<t[n];)n--;return{kind:cr[n],index:e-t[n]}}function si(e,t,n){let r=t*4;return e[r]<=n.maxX&&e[r+1]<=n.maxY&&e[r+2]>=n.minX&&e[r+3]>=n.minY}function ci(e,t){return e.minX<=t.maxX&&e.minY<=t.maxY&&e.maxX>=t.minX&&e.maxY>=t.minY}function li(e,t,n){let r=vr(e);if(n){let e=r.byKind.get(t.kind)??[],i=Dr(e,t.index);return i<0?-1:n.get(t.kind)[i]+t.index-e[i].first}let i=0;for(let e of r.runs){if(e.kind===t.kind&&t.index>=e.first&&t.index<e.first+e.count)return i+t.index-e.first;i+=e.count}return-1}function ui(e,t){let n=Pr(),r=!0;for(let i of[-t-1,0,t+1])for(let a of[-t-1,0,t+1]){let t=e.unproject({x:e.clientPoint.x+i,y:e.clientPoint.y+a});Lr(t)?Fr(n,t):r=!1}if(r){let n=t+1,i=[[-n,-n],[n,-n],[n,n],[-n,n]].map(([t,n])=>e.unproject({x:e.clientPoint.x+t,y:e.clientPoint.y+n})),a=0;for(let e=0;e<4;e++){let t=i[e],n=i[(e+1)%4],o=i[(e+2)%4];if(!Lr(t)||!Lr(n)||!Lr(o)){r=!1;break}let s=(n.x-t.x)*(o.y-n.y)-(n.y-t.y)*(o.x-n.x);if(!Number.isFinite(s)||s===0||a&&Math.sign(s)!==a){r=!1;break}a=Math.sign(s)}}return r||Object.assign(n,{minX:-1/0,minY:-1/0,maxX:1/0,maxY:1/0}),n}var di=class{index=null;empty=!1;disposed=!1;building=null;scene;defaultConditions;onBuildProgress;constructor(e,t){this.scene=e,this.defaultConditions=e.optionalContent?n(e).conditions:null,this.onBuildProgress=t}dispose(){this.disposed=!0,this.index=null,hr.delete(this.scene),gr.delete(this.scene),a(this.scene),_r.delete(this.scene)}async pickRanges(e,t){let n=()=>{if(e.signal?.throwIfAborted(),this.disposed)throw new DOMException(`Primitive picker disposed.`,`AbortError`)};n();let i=e.tolerancePx??4;if(!Number.isFinite(i)||i<0)throw RangeError(`Picking tolerance must be a finite nonnegative CSS pixel value.`);if(!Lr(e.point)||!Lr(e.clientPoint))return null;let a=e.isConditionVisible??(e=>e===void 0||!this.defaultConditions||this.defaultConditions[e]===1),o=new ii(n),s=ui(e,i),l=null;for(let u of t){let t=u.paintRun??u;if(c(this.scene,t,a))for(let c=u.first;c<u.first+u.count;c++){let d={kind:u.kind,index:c};if(o.shouldYield()&&await o.yield(),e.isVisible?.(d)===!1||!ci(Gr(this.scene,d),s))continue;let f=await this.hit(d,e,i,o);if(!f||l&&f.distancePx>=l.distancePx)continue;let p=await r(this.scene,t,f.closestPoint,{visible:a,sample:(t,n)=>this.samplePaint(t,n,e,o),yield:async()=>{o.shouldYield()&&await o.yield()}});if(p*(p===1?1:(await this.samplePaint(d,f.closestPoint,e,o)).color[3])>lr&&(l=f),l?.distancePx===0)return n(),l}}return n(),l}async pick(e){let t=()=>{if(e.signal?.throwIfAborted(),this.disposed)throw Error(`Primitive picker has been disposed.`)};t();let n=e.tolerancePx??4;if(!Number.isFinite(n)||n<0)throw RangeError(`Picking tolerance must be a finite nonnegative CSS pixel value.`);if(!Lr(e.point)||!Lr(e.clientPoint))return null;if(e.kinds?.some(e=>!cr.includes(e)))throw RangeError(`Unknown primitive kind.`);let i=new ii(t);!this.index&&!this.empty&&(this.building||=this.build(new ii(()=>{if(this.disposed)throw Error(`Primitive picker has been disposed.`)})).catch(e=>{throw this.reportBuildProgress(null),e}).finally(()=>{this.building=null}),await this.waitForBuild(this.building,e.signal),t());let a=e.kinds?new Set(e.kinds):null,o=null,s=-1,l=e.isConditionVisible??(t=>!!e.isVisible||t===void 0||!this.defaultConditions||this.defaultConditions[t]===1),u=async(t,u)=>{if(u<=s||a&&!a.has(t.kind)||e.isVisible?.(t)===!1)return;let d=yr(this.scene,t);if(!c(this.scene,d,l))return;if(!e.isVisible&&!e.isConditionVisible&&this.defaultConditions){let e=Tr(this.scene,t);if(e!==void 0&&this.defaultConditions[e]!==1)return}let f=await this.hit(t,e,n,i);if(f){let n=await r(this.scene,d,f.closestPoint,{visible:l,sample:(t,n)=>this.samplePaint(t,n,e,i),yield:async()=>{i.shouldYield()&&await i.yield()}});n*(n===1?1:(await this.samplePaint(t,f.closestPoint,e,i)).color[3])>lr&&(o=f,s=u)}};if(this.index){let t=this.index,r=ui(e,n),o=[t.levels.length-1,t.levels[t.levels.length-1]];for(;o.length;){let e=o.pop(),n=o.pop();if(!(t.maxRanks[e]<=s||!si(t.bounds,e,r))){if(n===0){let n=t.ids[e],o=n*t.groupSize;for(let e=Math.min(o+t.groupSize,t.total)-1;e>=o;e--){let o=oi(e,t.offsets);if(!a||a.has(o.kind)){let e=t.groupSize===1?t.ranks[n]:li(this.scene,o,t.runRanks);e>s&&(t.groupSize===1||o.kind===`gradient-stroke`||ci(Gr(this.scene,o),r))&&await u(o,e)}i.shouldYield()&&await i.yield()}}else{let r=t.levels[n-1]+2*(e-t.levels[n]),i=r+1,a=t.levels[n-1]+t.sizes[n-1];i<a&&t.maxRanks[i]<t.maxRanks[r]?o.push(n-1,i,n-1,r):(o.push(n-1,r),i<a&&o.push(n-1,i))}i.shouldYield()&&await i.yield()}}}return t(),o}async waitForBuild(e,t){if(!t)return e;t.throwIfAborted();let n=()=>{},r=new Promise((e,r)=>{n=()=>r(t.reason),t.addEventListener(`abort`,n,{once:!0})});try{await Promise.race([e,r])}finally{t.removeEventListener(`abort`,n)}}async build(e){this.reportBuildProgress(0);let t=pr(this.scene),n=[],r=0;for(let e of t)n.push(r),r+=e;if(!Number.isSafeInteger(r)||r<0)throw RangeError(`Invalid primitive count.`);if(r===0){this.empty=!0,this.reportBuildProgress(100);return}await e.yield();let i=vr(this.scene),a=i.runs,o=r*128+4096>ur&&a.length*8<ur/2?a.length*8:0,s=Math.floor((ur-o-4096)/128),c=Math.max(1,Math.ceil(r/s)),l=Math.ceil(r/c),u=o?new Map:void 0;if(u)for(let[e,t]of i.byKind)u.set(e,new Float64Array(t.length));let d=[0],f=[l],p=l;for(;f[f.length-1]>1;){let e=Math.ceil(f[f.length-1]/2);d.push(p),f.push(e),p+=e}if(this.onBuildProgress){let t=0,n=0;for(let n of a)t+=n.count,e.shouldYield()&&await e.yield();for(let t=0;t<this.scene.gradientStrokeRunCount;t++)n+=Math.max(0,Math.round(this.scene.gradientStrokeRunMetaA[t*4+1])),e.shouldYield()&&await e.yield();e.setProgress(r+l*9+t+n+p,e=>this.reportBuildProgress(e))}let m=new Uint32Array(l),h=new Uint32Array(l),g=new Uint32Array(l),_=new Float64Array(l*4),v=Pr();for(let t=0;t<r;t++){let r=oi(t,n),i;if(r.kind===`gradient-stroke`){i=Pr();let t=Vr(this.scene,r);for(let n=0;n<t.count;n++){let r=Ur(t,n),a=Math.max(0,this.scene.gradientStrokeStyles[(t.first+n)*4]);Fr(i,r.start,a),Fr(i,r.end,a),r.control&&Fr(i,r.control,a),e.shouldYield()&&await e.yield()}}else i=Gr(this.scene,r);let a=Math.floor(t/c),o=a*4;t%c===0?(_.set([i.minX,i.minY,i.maxX,i.maxY],o),m[a]=a):(_[o]=Math.min(_[o],i.minX),_[o+1]=Math.min(_[o+1],i.minY),_[o+2]=Math.max(_[o+2],i.maxX),_[o+3]=Math.max(_[o+3],i.maxY)),Fr(v,{x:i.minX,y:i.minY}),Fr(v,{x:i.maxX,y:i.maxY}),e.shouldYield()&&await e.yield()}let y=0;for(let t of a){let r=n[cr.indexOf(t.kind)];u&&(u.get(t.kind)[Dr(i.byKind.get(t.kind),t.first)]=y);for(let n=t.first;n<t.first+t.count;n++){let t=Math.floor((r+n)/c);h[t]=Math.max(h[t],y++),e.shouldYield()&&await e.yield()}}let b=Math.max(1e-12,v.maxX-v.minX),x=Math.max(1e-12,v.maxY-v.minY);for(let t=0;t<l;t++){let n=t*4,r=Math.max(0,Math.min(65535,Math.floor(((_[n]+_[n+2])*.5-v.minX)/b*65535))),i=Math.max(0,Math.min(65535,Math.floor(((_[n+1]+_[n+3])*.5-v.minY)/x*65535)));g[t]=(ai(r)|ai(i)<<1)>>>0,e.shouldYield()&&await e.yield()}let S=new Uint32Array(l),C=new Uint32Array(256),w=m,T=S;for(let t=0;t<32;t+=8){C.fill(0);for(let n=0;n<l;n++)C[g[w[n]]>>>t&255]++,e.shouldYield()&&await e.yield();let n=0;for(let e=0;e<256;e++){let t=C[e];C[e]=n,n+=t}for(let n=0;n<l;n++){let r=w[n];T[C[g[r]>>>t&255]++]=r,e.shouldYield()&&await e.yield()}[w,T]=[T,w]}let E=new Float64Array(p*4),D=new Uint32Array(p);for(let t=0;t<l;t++){let n=m[t];E.set(_.subarray(n*4,n*4+4),t*4),D[t]=h[n],e.shouldYield()&&await e.yield()}for(let t=1;t<d.length;t++)for(let n=0;n<f[t];n++){let r=d[t]+n,i=d[t-1]+n*2,a=Math.min(i+1,d[t-1]+f[t-1]-1);for(let e=0;e<4;e++)E[r*4+e]=(e<2?Math.min:Math.max)(E[i*4+e],E[a*4+e]);D[r]=Math.max(D[i],D[a]),e.shouldYield()&&await e.yield()}this.index={ids:m,bounds:E,ranks:h,maxRanks:D,levels:d,sizes:f,offsets:n,groupSize:c,total:r,runRanks:u},this.reportBuildProgress(100)}reportBuildProgress(e){if(!this.disposed)try{this.onBuildProgress?.(e)}catch{}}async samplePaint(e,t,n,r){let i={color:[0,0,0,0],shape:0};if(!Ir(t,Gr(this.scene,e)))return i;let a=n.project(t);if(!a)return i;let o=await this.hit(e,{...n,point:t,clientPoint:a},0,r,!0);if(!o)return i;if(e.kind===`raster`){let r=n.rasterLayers?.get(e.index)??this.scene.rasterLayers[e.index],a=zr(t,r.matrix);if(!a)return i;let o=a.x*r.width-.5,s=a.y*r.height-.5,c=Math.floor(o),l=Math.floor(s),u=o-c,d=s-l,f=e=>{let t=(t,n)=>{let i=(Math.max(0,Math.min(r.height-1,n))*r.width+Math.max(0,Math.min(r.width-1,t)))*4;return r.data[i+e]/255*(e===3?1:r.data[i+3]/255)};return(t(c,l)*(1-u)+t(c+1,l)*u)*(1-d)+(t(c,l+1)*(1-u)+t(c+1,l+1)*u)*d},p=f(3),m=p*(r.opacity??1),h=r.opacity??1;return{color:[f(0)*h,f(1)*h,f(2)*h,m],shape:p}}let s=qr(this.scene,e),c=s.getSegmentStyle(o.segmentIndex??0),l=c.color??[0,0,0],u=c.opacity;return s.gradientIndex!==void 0&&s.gradientIndex!==null&&(l=[0,1,2].map(e=>sr(this.scene,s.gradientIndex,t.x,t.y,e)),u*=$r(this.scene,s.gradientIndex,t)),s.maskGradientIndex!==void 0&&s.maskGradientIndex!==null&&(u*=$r(this.scene,s.maskGradientIndex,t)),l=n.resolveColor?.(e,l)??l,{color:[l[0]*u,l[1]*u,l[2]*u,u],shape:1}}async hit(e,t,n,r,i=!1){let a=this.scene,o=e.index*4,s=Or(a,e);if(!Qr(a,t.point,s.clipIndex,s.rect))return null;if(e.kind===`raster`){let o=t.rasterLayers?.get(e.index)??a.rasterLayers[e.index],c=i?{...o,opacity:1}:o;if(ei(a,e.index,t.point,c)>lr)return{primitive:{...e},...wr(this.scene,e),point:{...t.point},closestPoint:{...t.point},distancePx:0};let l=zr(t.point,o.matrix);if(!l||l.x>=0&&l.x<=1&&l.y>=0&&l.y<=1)return null;let u=Wr(a,e.index,o),d=null;for(let e=0;e<4;e++){let n=await ni({start:u[e],end:u[(e+1)%4]},t,r);n&&(!d||n.distance<d.distance)&&(d=n)}return!d||d.distance>n||ei(a,e.index,d.point,c)<=lr||!Qr(a,d.point,s.clipIndex,s.rect)?null:{primitive:{...e},...wr(this.scene,e),point:{...t.point},closestPoint:d.point,distancePx:d.distance}}let c=Vr(a,e),l=e.kind===`stroke`||e.kind===`gradient-stroke`,u=1,d=!1,f=-1,p=-1;if(e.kind===`text`&&(u=a.textInstanceC[o+3]),e.kind===`fill`||e.kind===`gradient-fill`){let t=e.kind===`fill`?a.fillPathMetaC:a.gradientFillPathMetaC;u=t[o+3],d=t[o]>=.5}if(e.kind===`gradient-fill`&&(f=a.gradientFillPaintMeta[o],p=a.gradientFillPaintMeta[o+1]),e.kind===`gradient-stroke`&&(f=a.gradientStrokeRunMetaA[o+2],p=a.gradientStrokeRunMetaA[o+3]),i&&(u=1),u<=lr)return null;let m=0,h=null,g=-1;for(let n=0;n<c.count;n++){let o=Ur(c,n);l||(m+=Xr(o,t.point));let d=await ni(o,t,r);if(d){let m=d.distance,_=d.point,v=s.rect,y=u;if(l){let l=(c.first+n)*4,u=c.b[l+3],f=e.kind===`stroke`?a.styles:a.gradientStrokeStyles,p=e.kind===`gradient-stroke`?Ar(a.gradientStrokePrimitiveMeta,a.gradientStrokePrimitiveBounds,c.first+n):s.rect;if(v=p,y=i?1:Mr(u),!i&&Mr(u)<=lr||p&&!Ir(t.point,p)){r.shouldYield()&&await r.yield();continue}if(Math.hypot(o.start.x-o.end.x,o.start.y-o.end.y)<1e-8&&(!o.control||Math.hypot(o.start.x-o.control.x,o.start.y-o.control.y)<1e-8)&&!(jr(u)&2)){r.shouldYield()&&await r.yield();continue}if(!(jr(u)&1)){let e=await ri(o,Math.max(0,f[l]),t,r,d);if(!e){r.shouldYield()&&await r.yield();continue}m=e.distance,_=e.point}else if(m=Math.max(0,m-.5),m===0)_=t.point;else if(d.distance>0){let e=t.project(d.point);e&&(_=t.unproject({x:e.x+(t.clientPoint.x-e.x)*.5/d.distance,y:e.y+(t.clientPoint.y-e.y)*.5/d.distance})??d.point)}}Qr(a,_,s.clipIndex,v)&&y*$r(a,f,_)*$r(a,p,_)>lr&&(!h||m<h.distance)&&(h={point:Qr(a,d.point,s.clipIndex,v)?d.point:_,distance:m},g=n)}r.shouldYield()&&await r.yield()}if(!l&&(d?Math.abs(m)%2==1:m!==0)&&u*$r(a,f,t.point)*$r(a,p,t.point)>lr)return{primitive:{...e},...wr(this.scene,e),point:{...t.point},closestPoint:{...t.point},distancePx:0};let _=-1;if(!l&&f>=0&&a.gradientMetaA[f*4]===2&&n>0){let e=jt(a,f),i=f*4;for(let o=0;o<e;o++){let e=Mt(a,f,o);for(let l=0;l<3;l++){let f=e.points[l],m=e.points[(l+1)%3],g=await ni({start:f,end:m},t,r);if(!g||g.distance>n||h&&g.distance>=h.distance||!Qr(a,g.point,s.clipIndex,s.rect))continue;let v=a.gradientMetaB,y=a.gradientMetaC,b=a.gradientMetaE,x=g.point,S=v[i]*x.x+v[i+2]*x.y+y[i],C=v[i+1]*x.x+v[i+3]*x.y+y[i+1];if(a.gradientMetaA[i+1]>=.5&&(S<b[i]||C<b[i+1]||S>b[i+2]||C>b[i+3]))continue;let w=m.x-f.x,T=m.y-f.y,E=w*w+T*T,D=E>0?Math.max(0,Math.min(1,((x.x-f.x)*w+(x.y-f.y)*T)/E)):0,O=e.colors[l][3]*(1-D)+e.colors[(l+1)%3][3]*D;if(u*O*$r(a,p,x)<=lr)continue;let k=0,A=!1;for(let e=0;e<c.count;e++){let t=Ur(c,e);k+=Xr(t,x),!t.control&&ti(t.start,t.end,x).distance<1e-7&&(A=!0),r.shouldYield()&&await r.yield()}(A||(d?Math.abs(k)%2==1:k!==0))&&(h=g,_=o)}r.shouldYield()&&await r.yield()}}return!h||h.distance>n+1e-7?null:{primitive:{...e},...wr(this.scene,e),point:{...t.point},closestPoint:h.point,distancePx:h.distance,..._>=0?{triangleIndex:_}:{segmentIndex:g}}}},fi=[.15,.45,1],pi=[1,.65,.05];function V(e){return`${e.kind}:${e.index}`}function mi(e){if(Array.isArray(e)){if(e.length!==3||!e.every(Number.isFinite))throw TypeError(`Invalid primitive color channels.`);return e.map(e=>Math.max(0,Math.min(1,e)))}let t;if(typeof e==`number`)t=e;else if(typeof e==`string`){let n=e.trim().toLowerCase();if(/^#[\da-f]{3}$/.test(n))t=parseInt(n.slice(1).split(``).map(e=>e+e).join(``),16);else if(/^#?[\da-f]{6}$/.test(n))t=parseInt(n.replace(/^#/,``),16);else if(Object.hasOwn(At,n))t=At[n];else throw TypeError(`Unsupported primitive color: ${e}`)}else throw TypeError(`Invalid primitive color.`);if(!Number.isInteger(t)||t<0||t>16777215)throw TypeError(`Invalid primitive color number.`);return[(t>>>16)/255,(t>>>8&255)/255,(t&255)/255]}var hi=class{colors=new Map;selected=[];hover=null;annotationSelected=[];annotationHovered=[];annotationFallback=null;highlights=null;disposed=!1;scene;callbacks;constructor(e,t={}){this.scene=e,this.callbacks=t}getSelection(){return this.selected.map(e=>({...e}))}getHover(){return this.hover&&{...this.hover}}getOverrideColor(e){mr(this.scene,e);let t=this.colors.get(V(e))?.color;return t?[...t]:null}getHighlights(){return this.highlights}getColorUpdates(){return[...this.colors.values()].map(({ref:e,color:t})=>({ref:{...e},color:t&&[...t]}))}hasAnyOverrides(){return this.colors.size>0}hasOverrides(e){for(let t of this.colors.values())if(t.ref.kind===e)return!0;return!1}setHover(e){if(this.assertLive(),e&&mr(this.scene,e),e?this.hover&&V(e)===V(this.hover):!this.hover)return;let t=e&&{...e},n=this.buildHighlights(this.selected,t);this.hover=t,this.highlights=n,this.callbacks.onHighlights?.(n)}setSelection(e){this.assertLive();let t=this.validateRefs(e);if(t.length===this.selected.length&&t.every((e,t)=>V(e)===V(this.selected[t])))return;let n=this.buildHighlights(t,this.hover);this.selected=t,this.highlights=n,this.callbacks.onHighlights?.(n)}setAnnotationHighlights(e,t,n){this.assertLive();let r=this.validateRefs(e),i=this.validateRefs(t),a=_i(gi(this.scene,[...this.selected,...r],[...this.hover?[this.hover]:[],...i],r.length||i.length?262144:1/0,!!(r.length||i.length||n)),n);this.annotationSelected=r,this.annotationHovered=i,this.annotationFallback=n,this.highlights=a,this.callbacks.onHighlights?.(a)}buildHighlights(e,t){return _i(gi(this.scene,[...e,...this.annotationSelected],[...t?[t]:[],...this.annotationHovered],1/0,!!(this.annotationSelected.length||this.annotationHovered.length||this.annotationFallback)),this.annotationFallback)}setOverrides(e,t){this.assertLive();let n=this.validateRefs(e);if(n.some(e=>e.kind===`raster`))throw TypeError(`Raster layers support highlighting, but not color overrides.`);let r=mi(t?.color),i=n.filter(e=>{let t=this.colors.get(V(e))?.color;return!t||t.some((e,t)=>e!==r[t])}).map(e=>({ref:e,color:[...r]}));for(let e of i)this.colors.set(V(e.ref),e);i.length&&this.callbacks.onColors?.(i)}clearOverrides(e){this.assertLive();let t=e===void 0?[...this.colors.values()].map(e=>e.ref):this.validateRefs(e),n=[];for(let e of t)this.colors.delete(V(e))&&n.push({ref:e,color:null});n.length&&this.callbacks.onColors?.(n)}clear(){this.assertLive(),this.clearOverrides();let e=this.highlights!==null;this.selected=[],this.hover=null,this.annotationSelected=[],this.annotationHovered=[],this.annotationFallback=null,this.highlights=null,e&&this.callbacks.onHighlights?.(null)}dispose(){this.disposed||=(this.clear(),!0)}assertLive(){if(this.disposed)throw Error(`Primitive appearance state has been disposed.`)}validateRefs(e){if(!Array.isArray(e))throw TypeError(`Primitive references must be an array.`);let t=new Map;for(let n of e)mr(this.scene,n),t.set(V(n),{...n});return[...t.values()]}};function gi(e,t,n,r=1/0,i=!1){let a=n?Array.isArray(n)?n:[n]:[],o=[...t,...a];if(i){let e=new Map;for(let n of t)e.set(V(n),n);t=[...e.values()],o=[...t];for(let t of a)e.has(V(t))||(e.set(V(t),t),o.push(t))}if(!o.length)return null;let s=new Map,c=0,l=0;for(let n=0;n<o.length;n++){let i=V(o[n]),a=s.get(i);if(!a){let t=qr(e,o[n]),r=t.kind===`gradient-fill`&&t.shadingKind===`mesh`?Ft(e,t.gradientIndex):void 0;s.set(i,a={primitive:t,...r?{mesh:r}:{}})}if(c+=a.mesh?a.mesh.edges.length/4:a.primitive.segmentCount,c>r)throw RangeError(`Annotation highlight trace exceeds its segment budget.`);n===t.length-1&&(l=c)}if(!c)return null;let u=new Float32Array(c*8),d=[],f=new Map,p=new Map,m=t=>{if(t<0)return-1;let n=f.get(t);if(n!==void 0)return n;let r=e.clipPaths?.[t];if(!r)throw RangeError(`Invalid primitive clip reference.`);let i=m(r.parent),a=d.length;return d.push({parent:i,fillRule:r.fillRule,edges:r.edges.slice()}),f.set(t,a),a},h=(e,t)=>{if(!t)return e;let{minX:n,minY:r,maxX:i,maxY:a}=t,o=`${e}:${n}:${r}:${i}:${a}`,s=p.get(o);if(s!==void 0)return s;let c=d.length;return d.push({parent:e,fillRule:0,edges:Float32Array.of(n,r,i,r,i,r,i,a,i,a,n,a,n,a,n,r)}),p.set(o,c),c},g=0,_=new Map;for(let t of o){let n=V(t),{primitive:r,mesh:i}=s.get(n),a=Or(e,t),o=h(m(a.clipIndex),a.rect);if(i){let e=_.get(n);e===void 0&&(e=d.length,d.push({parent:o,fillRule:+(r.fillRule===`evenodd`),edges:vi(r)}),i.domainClip&&(d.push({parent:e,fillRule:0,edges:i.domainClip}),e=d.length-1),_.set(n,e));for(let t=0;t<i.edges.length;t+=4){let n=i.edges[t],r=i.edges[t+1],a=i.edges[t+2],o=i.edges[t+3];u.set([n,r,a,o,a,o,0,e],g),g+=8}continue}for(let n=0;n<r.segmentCount;n++){let i=r.getSegment(n),a=i.control??i.end,s=t.kind===`gradient-stroke`?h(o,kr(e,t,n)):o;u.set([i.start.x,i.start.y,a.x,a.y,i.end.x,i.end.y,+!!i.control,s],g),g+=8}}return{segments:u,clipPaths:d,selectionCount:l,count:c}}function _i(e,t){if(!e)return t;if(!t)return e;let n=new Float32Array((e.count+t.count)*8),r=[...e.clipPaths,...t.clipPaths.map(t=>({...t,parent:t.parent<0?-1:t.parent+e.clipPaths.length}))],i=0,a=(e,t,r,a)=>{for(let o=t;o<r;o++)n.set(e.segments.subarray(o*8,o*8+8),i),n[i+7]>=0&&(n[i+7]+=a),i+=8};return a(e,0,e.selectionCount,0),a(t,0,t.selectionCount,e.clipPaths.length),a(e,e.selectionCount,e.count,0),a(t,t.selectionCount,t.count,e.clipPaths.length),{segments:n,clipPaths:r,selectionCount:e.selectionCount+t.selectionCount,count:e.count+t.count}}function vi(e){let t=[],n=(e,n,r,i)=>{if(e!==r||n!==i){if(t.length/4>=8192)throw RangeError(`Mesh highlight paint clipping exceeds its edge budget.`);t.push(e,n,r,i)}},r=(e,t,i,a,o,s,c=0)=>{let l=o-e,u=s-t,d=Math.max(0,Math.min(1,((i-e)*l+(a-t)*u)/(l*l+u*u||1)));if(Math.hypot(i-e-d*l,a-t-d*u)<=1e-4){n(e,t,o,s);return}if(c>=20)throw RangeError(`Mesh highlight paint clipping exceeds its subdivision budget.`);let f=(e+i)/2,p=(t+a)/2,m=(i+o)/2,h=(a+s)/2,g=(f+m)/2,_=(p+h)/2;r(e,t,f,p,g,_,c+1),r(g,_,m,h,o,s,c+1)};if(e.segmentCount>8192)throw RangeError(`Mesh highlight paint clipping exceeds its edge budget.`);for(let t=0;t<e.segmentCount;t++){let{start:i,control:a,end:o}=e.getSegment(t);a?r(i.x,i.y,a.x,a.y,o.x,o.y):n(i.x,i.y,o.x,o.y)}return Float32Array.from(t)}var yi=65536,bi=65536,xi=new WeakSet;function Si(e,t){return{minX:Math.min(e.minX,t.minX),minY:Math.min(e.minY,t.minY),maxX:Math.max(e.maxX,t.maxX),maxY:Math.max(e.maxY,t.maxY)}}function Ci(e,t){return e.minX<=t.maxX&&e.maxX>=t.minX&&e.minY<=t.maxY&&e.maxY>=t.minY}function wi(e){e.sort((e,t)=>e.bounds.minX+e.bounds.maxX-t.bounds.minX-t.bounds.maxX);let t=(n,r)=>{if(n===r)return null;if(r-n===1)return e[n];let i=n+r>>>1,a=t(n,i),o=t(i,r);return{bounds:Si(a.bounds,o.bounds),left:a,right:o}};return t(0,e.length)}function Ti(e,t){let n=[],r=e?[e]:[];for(;r.length;){let e=r.pop();Ci(e.bounds,t)&&(e.value===void 0?r.push(e.left,e.right):n.push(e.value))}return n}function Ei(e){let{minX:t,minY:n,maxX:r,maxY:i}=e;return{points:[{x:t,y:n},{x:r,y:n},{x:r,y:i},{x:t,y:i}],closed:!0,filled:!0}}function Di(e){return Array.from({length:e.length/2},(t,n)=>({x:e[n*2],y:e[n*2+1]}))}function Oi(e){if((e.quadPoints?.length??0)/2+(e.vertices?.length??0)/2+(e.line?.length??0)/2+(e.inkList?.reduce((e,t)=>e+t.length/2,0)??0)>yi)return xi.has(e)||(xi.add(e),console.warn(`[HEPR] Annotation ${e.id} metadata exceeds the interaction point budget; using its bounds.`)),[Ei(e.bounds)];if(e.quadPoints?.length){let t=[];for(let n=0;n<e.quadPoints.length;n+=8){let r=Di(e.quadPoints.slice(n,n+8)),i=r.reduce((e,t)=>({x:e.x+t.x/4,y:e.y+t.y/4}),{x:0,y:0});r.sort((e,t)=>Math.atan2(e.y-i.y,e.x-i.x)-Math.atan2(t.y-i.y,t.x-i.x)),t.push({points:r,closed:!0,filled:!0})}return t}return e.inkList?.some(e=>e.length)?e.inkList.filter(e=>e.length).map(e=>({points:Di(e),closed:!1,filled:!1})):e.vertices?.length?[{points:Di(e.vertices),closed:e.subtype===`Polygon`,filled:e.subtype===`Polygon`}]:e.line?.length?[{points:Di(e.line),closed:!1,filled:!1}]:[Ei(e.bounds)]}function ki(e,t){return e.subtype===`Popup`||e.flags&35?!1:e.optionalContent===void 0?e.visibleInDefaultView:t.conditions[e.optionalContent]===1}function Ai(e){let t=[],n=new Set;for(let r of e)for(let e=r.first;e<r.first+r.count;e++){let i=`${r.kind}:${e}`;n.has(i)||(n.add(i),t.push({kind:r.kind,index:e}))}return t}var ji=class{entries=new Map;root=null;prepared=!1;building=null;disposed=!1;scene;constructor(e){this.scene=e;let t=br(e);for(let n of e.annotations??[]){let e=this.entries.get(n.id);e?(e.annotations.push(n),e.bounds=Si(e.bounds,n.bounds)):this.entries.set(n.id,{id:n.id,annotations:[n],runs:t.get(n.id)??[],bounds:{...n.bounds}})}}get(e){if(this.disposed)throw Error(`Annotation index disposed.`);let t=this.entries.get(e);if(!t)throw RangeError(`Unknown annotation: ${e}`);return t}async query(e,t){if(t?.throwIfAborted(),this.disposed||(this.prepared||(this.building??=this.build().finally(()=>{this.building=null}),await o(this.building,t)),this.disposed))throw new DOMException(`Annotation index disposed.`,`AbortError`);return t?.throwIfAborted(),Ti(this.root,e)}appearanceRanges(e,t){return e.geometry?Ti(e.geometry,t):e.runs}dispose(){this.disposed=!0,this.entries.clear(),this.root=null}async build(){let e=0,t=performance.now(),n=[...this.entries.values()].reduce((e,t)=>e+t.runs.reduce((e,t)=>e+t.count,0),0),r=Math.max(64,Math.ceil(n/bi)),i=0,a=!1,o=()=>{if(this.disposed)throw new DOMException(`Annotation index disposed.`,`AbortError`)};for(let n of this.entries.values()){o();let s=[],c=!1;for(let r of n.annotations)for(let i of Oi(r))for(let a of i.points){let i=Mi(r);n.bounds=Si(n.bounds,{minX:a.x-i,minY:a.y-i,maxX:a.x+i,maxY:a.y+i}),++e%1024==0&&performance.now()-t>=8&&(await new Promise(e=>setTimeout(e,0)),o(),t=performance.now())}for(let a of n.runs)for(let l=a.first;l<a.first+a.count;l+=r){let u=Math.min(r,a.first+a.count-l),d={minX:1/0,minY:1/0,maxX:-1/0,maxY:-1/0};for(let n=l;n<l+u;n++)d=Si(d,Sr(this.scene,{kind:a.kind,index:n})),++e%1024==0&&performance.now()-t>=8&&(await new Promise(e=>setTimeout(e,0)),o(),t=performance.now());n.bounds=Si(n.bounds,d),i<bi?(i++,s.push({bounds:d,value:{kind:a.kind,first:l,count:u,paintRun:a}})):c=!0}n.geometry=c?null:wi(s),c&&!a&&(a=!0,console.warn(`[HEPR] Annotation picking index reached its block budget; fragmented appearances use bounded-memory geometry scans.`))}o(),this.root=wi([...this.entries.values()].map(e=>({bounds:e.bounds,value:e}))),this.prepared=!0}};function Mi(e){let t=e.pdfGeometry.rect,n=e.bounds,r=Math.abs((t[2]-t[0])*(t[3]-t[1])),i=r>0?Math.sqrt(Math.abs((n.maxX-n.minX)*(n.maxY-n.minY))/r):1;return Math.max(0,e.border?.width??1)*i/2}function Ni(e,t,n){let r=n.x-t.x,i=n.y-t.y,a=Math.max(0,Math.min(1,((e.x-t.x)*r+(e.y-t.y)*i)/(r*r+i*i||1)));return Math.hypot(e.x-t.x-a*r,e.y-t.y-a*i)}function Pi(e,t){let n=!1;for(let r=0,i=e.length-1;r<e.length;i=r++){let a=e[r],o=e[i];a.y>t.y!=o.y>t.y&&t.x<a.x+(t.y-a.y)*(o.x-a.x)/(o.y-a.y)&&(n=!n)}return n}function Fi(e,t){let n=Ei(e.bounds).points.map(t);if(n.some(e=>!e))return 1/0;let r=0;for(let e=0;e<4;e++){let t=n[e],i=n[(e+1)%4];r+=t.x*i.y-t.y*i.x}return Math.abs(r)/2}function Ii(e,t,n,r){let i=1/0;for(let r of Oi(e)){let a=r.points.map(n);if(a.some(e=>!e))continue;let o=a;if(r.filled&&Pi(o,t))return 0;for(let a=0;a<o.length;a++){let s=a+1<o.length?a+1:r.closed?0:a,c=0;if(!r.filled){let t=Mi(e),i=r.points[a],s=o[a];for(let e of[{x:i.x+t,y:i.y},{x:i.x,y:i.y+t}]){let t=n(e);t&&(c=Math.max(c,Math.hypot(t.x-s.x,t.y-s.y)))}}i=Math.min(i,Math.max(0,Ni(t,o[a],o[s])-c))}}return i<=r?i:null}function Li(e,t,n=!1){let r=[],i=0;for(let[a,o]of[e,t].entries()){for(let e of o){let t=n?[Ei(e.bounds)]:Oi(e);for(let e of t)for(let t=0;t<e.points.length;t++){let n=e.points[t],i=e.points[t+1]??(e.closed?e.points[0]:n);if(!(t===e.points.length-1&&!e.closed&&e.points.length>1)){if(r.length/8>=262144)throw RangeError(`Annotation metadata highlight exceeds its segment budget.`);r.push(n.x,n.y,i.x,i.y,i.x,i.y,0,-1)}}}a===0&&(i=r.length/8)}return r.length?{segments:Float32Array.from(r),clipPaths:[],selectionCount:i,count:r.length/8}:null}function Ri(e,t,n,r,i,a){let o=[],s=[],c=[],l=[],u=(n,i,a)=>{let c=t.get(n),l=c.annotations.filter(e=>ki(e,r));if(l.length){if(!c.runs.length){for(let e of l)a.push(e);return}for(let t of c.runs)if(Er(e,{kind:t.kind,index:t.first},e=>e===void 0||r.conditions[e]===1))for(let e=t.first;e<t.first+t.count;e++){if(o.length+s.length>=262144)throw RangeError(`Annotation highlight exceeds its primitive budget.`);i.push({kind:t.kind,index:e})}}};try{for(let e of i)u(e,o,c);a!==null&&!i.includes(a)&&u(a,s,l),n.setAnnotationHighlights(o,s,Li(c,l))}catch(e){if(!(e instanceof RangeError))throw e;console.warn(`[HEPR] Annotation highlight fidelity reduced; using metadata bounds.`,e.message);let o=i.flatMap(e=>t.get(e).annotations.filter(e=>ki(e,r))),s=a!==null&&!i.includes(a)?t.get(a).annotations.filter(e=>ki(e,r)):[];n.setAnnotationHighlights([],[],Li(o,s,!0))}}async function zi(e,t,n,r,i,a,o,s){let c=r.tolerancePx??4,l=ui(r,c),u=await t.query(l,r.signal);s();let d=[],f=a?null:o;for(let t of u)for(let n of t.annotations){if(!ki(n,i))continue;let a=n.pageIndex*4,o=e.pageRects,s=r.point;s.x<o[a]||s.x>o[a+2]||s.y<o[a+1]||s.y>o[a+3]||d.push({entry:t,annotation:n,area:Fi(n,r.project)})}d.sort((e,t)=>e.area-t.area||t.annotation.annotationIndex-e.annotation.annotationIndex||t.annotation.pageIndex-e.annotation.pageIndex||e.annotation.id.localeCompare(t.annotation.id));let p=null,m=1/0,h=performance.now();for(let{entry:e,annotation:a,area:o}of d){if(r.signal?.throwIfAborted(),s(),p&&o>m)break;let u;u=e.runs.length?(await n.pickRanges({...r,isConditionVisible:e=>e===void 0||i.conditions[e]===1},t.appearanceRanges(e,l)))?.distancePx??null:f?.has(a.id)?null:Ii(a,r.clientPoint,r.project,c),u!==null&&(!p||o<m||u<p.distancePx)&&(p={annotationId:a.id,distancePx:u},m=o),performance.now()-h>=8&&(await new Promise(e=>setTimeout(e,0)),h=performance.now())}return r.signal?.throwIfAborted(),s(),p}function Bi(e){let t=Math.max(0,e.segmentCount|0);return{count:t,segments:[{first:0,count:t,scene:e}]}}function Vi(e){return e.records??Bi(e.scene)}function Hi(e,t){let n=e.segments,r=0;for(;r+1<n.length&&t>=n[r+1].first;)r++;return n[r]}function*Ui(e,t,n,r=4194304){let i=Math.max(0,e.count|0),a=Math.max(1,Math.floor(r/(n*16))),o=e.segments.filter(e=>e.count>0),s=o.map(e=>Math.min(e.count,Math.floor(e.scene[t].length/4))),c=Math.ceil(i/n),l=0;for(let e=0;e<c;){let r=e*n,c=Math.min(r+n,i);for(;l+1<o.length&&r>=o[l+1].first;)l++;let u=o[l];if(u&&c<=u.first+s[l]){let i=1;if(c-r===n){let t=Math.floor((u.first+s[l])/n);i=Math.max(1,Math.min(a,t-e))}let o=(r-u.first)*4,d=i===1?c-r:i*n;yield{y:e,width:i===1?c-r:n,height:i,data:u.scene[t].subarray(o,o+d*4)},e+=i;continue}let d=new Float32Array((c-r)*4),f=!1;for(let e=l;e<o.length&&o[e].first<c;e++){let n=o[e],i=Math.max(r,n.first),a=Math.min(c,n.first+n.count),s=n.scene[t],l=(i-n.first)*4,u=Math.min(s.length,(a-n.first)*4);u<=l||(d.set(s.subarray(l,u),(i-r)*4),f=!0)}f&&(yield{y:e,width:c-r,height:1,data:d}),e++}}var Wi=[`endpoints`,`primitiveMeta`,`primitiveBounds`,`styles`];function Gi(e){let t=e.segments[0],n=Math.max(0,t?.count??0),r=Math.max(1,Math.ceil(Math.sqrt(n))),i=Math.floor(n/r),a=r*i,o=Math.max(0,e.count-a),s=Math.max(1,Math.ceil(Math.sqrt(o))),c=Math.max(1,Math.ceil(o/s)),l={},u={};for(let n of Wi){let o=t?.scene[n];if(a===0)l[n]={width:1,height:1,data:new Float32Array(4)};else if(o&&o.length>=a*4)l[n]={width:r,height:i,data:o.subarray(0,a*4)};else{let e=new Float32Array(a*4);o&&e.set(o.subarray(0,Math.min(o.length,e.length))),l[n]={width:r,height:i,data:e}}let d=new Float32Array(s*c*4);for(let r of e.segments){let e=Math.max(r.first,a),i=r.first+r.count;if(i<=e)continue;let o=r.scene[n],s=(e-r.first)*4,c=Math.min(o.length,(i-r.first)*4);c>s&&d.set(o.subarray(s,c),(e-a)*4),r!==t&&(r.scene[n]=d.subarray((r.first-a)*4,(i-a)*4))}u[n]={width:s,height:c,data:d}}return{split:a,head:l,tail:u}}var Ki=1024,qi=64,Ji=class{selected=null;selectedFlags=null;bounds;visible=[];scene;clipBounds;paddedBounds=null;padding=NaN;allPaddedBounds=null;nonemptyRuns=[];nonemptyFlags=null;allPaddedRuns=[];guardBounds=null;guardRuns=[];guardFlags=null;constructor(e,t){this.scene=e;let n=e.drawRuns??[];this.bounds=new Float64Array(n.length*4);let r=(e.clipPaths??[]).map(e=>{let t=[1/0,1/0,-1/0,-1/0];for(let n=0;n<e.edges.length;n+=2)t[0]=Math.min(t[0],e.edges[n]),t[1]=Math.min(t[1],e.edges[n+1]),t[2]=Math.max(t[2],e.edges[n]),t[3]=Math.max(t[3],e.edges[n+1]);return t});if(this.clipBounds=r,e.clipPaths?.forEach((e,t)=>{e.parent>=0&&Zi(r[t],r[e.parent])}),n.forEach((t,n)=>{let r=[1/0,1/0,-1/0,-1/0],i=(e,t,n=0)=>{r[0]=Math.min(r[0],e-n),r[1]=Math.min(r[1],t-n),r[2]=Math.max(r[2],e+n),r[3]=Math.max(r[3],t+n)};for(let n=t.first;n<t.first+t.count;n++){let a=n*4;if(t.kind===`stroke`){let t=Math.SQRT2*Math.max(0,e.styles[a]);i(e.endpoints[a],e.endpoints[a+1],t),i(e.endpoints[a+2],e.endpoints[a+3],t),i(e.primitiveMeta[a],e.primitiveMeta[a+1],t)}else if(t.kind===`fill`)i(e.fillPathMetaA[a+2],e.fillPathMetaA[a+3]),i(e.fillPathMetaB[a],e.fillPathMetaB[a+1]);else if(t.kind===`text`){let t=Math.round(e.textInstanceB[a+2])*4;for(let n of[e.textGlyphMetaA[t+2],e.textGlyphMetaB[t]])for(let r of[e.textGlyphMetaA[t+3],e.textGlyphMetaB[t+1]])i(e.textInstanceA[a]*n+e.textInstanceA[a+2]*r+e.textInstanceB[a],e.textInstanceA[a+1]*n+e.textInstanceA[a+3]*r+e.textInstanceB[a+1])}else if(t.kind===`raster`){let t=l(e,n);if(t){i(t.minX,t.minY),i(t.maxX,t.maxY);continue}let r=e.rasterLayers[n].matrix;for(let e of[0,1])for(let t of[0,1])i(r[0]*e+r[2]*t+r[4],r[1]*e+r[3]*t+r[5])}else{r.splice(0,4,-1/0,-1/0,1/0,1/0);break}}this.bounds.set(r,n*4)}),t){n.forEach((e,t)=>{e.kind===`stroke`&&this.bounds.set([1/0,1/0,-1/0,-1/0],t*4)});for(let e of Vi(t).segments)for(let n=0;n<e.count;n++)Yi(this.bounds,t.sourceRuns[e.first+n]*4,e.scene,n)}}includeTextLod(e){let t=(this.scene.drawRuns??[]).flatMap((e,t)=>e.kind===`text`?[{run:e,index:t}]:[]).sort((e,t)=>e.run.first-t.run.first),n=0;for(let r of e.runs){if(r.coarseIndex<0)continue;for(;n<t.length&&t[n].run.first+t[n].run.count<=r.exactStart;)n++;if(n===t.length)break;let e=t[n].index*4,i=r.bounds;this.bounds[e]=Math.min(this.bounds[e],i.minX),this.bounds[e+1]=Math.min(this.bounds[e+1],i.minY),this.bounds[e+2]=Math.max(this.bounds[e+2],i.maxX),this.bounds[e+3]=Math.max(this.bounds[e+3],i.maxY)}this.padding=NaN,this.guardBounds=null}getUnclippedBounds(e,t,n){let r=e*4;n[0]=this.bounds[r]-t,n[1]=this.bounds[r+1]-t,n[2]=this.bounds[r+2]+t,n[3]=this.bounds[r+3]+t}getBounds(e,t,n){this.getUnclippedBounds(e,t,n);let r=this.scene.drawRuns[e].clipIndex;r!==void 0&&Zi(n,this.clipBounds[r])}select(e,t,n=0){let r=this.scene.drawRuns??[];if(this.selected=null,!e||![e.minX,e.minY,e.maxX,e.maxY].every(Number.isFinite))return this.guardBounds=null,r;let i=Math.max(n,.001,t*4);if(!Number.isFinite(i))return this.guardBounds=null,r;let a=2**Math.ceil(Math.log2(i));if(!this.paddedBounds||this.padding!==a){this.paddedBounds??=new Float64Array(this.bounds.length),this.padding=a,this.guardBounds=null;let e=[0,0,0,0],t={minX:1/0,minY:1/0,maxX:-1/0,maxY:-1/0};this.nonemptyRuns.length=0,this.nonemptyFlags??=new Uint8Array(r.length),this.nonemptyFlags.fill(0);for(let n=0;n<r.length;n++)this.getBounds(n,a,e),this.paddedBounds.set(e,n*4),!(e[0]>e[2]||e[1]>e[3])&&(this.nonemptyRuns.push(r[n]),this.nonemptyFlags[n]=1,t.minX=Math.min(t.minX,e[0]),t.minY=Math.min(t.minY,e[1]),t.maxX=Math.max(t.maxX,e[2]),t.maxY=Math.max(t.maxY,e[3]));this.allPaddedBounds=t,this.allPaddedRuns=this.nonemptyRuns.length===r.length?r:this.nonemptyRuns}let o=r.length>=Ki&&t>0?qi*t:0;if(o>0&&this.guardBounds&&e.minX>=this.guardBounds.minX&&e.minY>=this.guardBounds.minY&&e.maxX<=this.guardBounds.maxX&&e.maxY<=this.guardBounds.maxY&&this.guardBounds.maxX-this.guardBounds.minX<=e.maxX-e.minX+o*4&&this.guardBounds.maxY-this.guardBounds.minY<=e.maxY-e.minY+o*4)return this.selected=this.guardFlags,this.guardRuns;let s=o>0?{minX:e.minX-o,minY:e.minY-o,maxX:e.maxX+o,maxY:e.maxY+o}:null;s&&[s.minX,s.minY,s.maxX,s.maxY].every(Number.isFinite)?e=s:(s=null,this.guardBounds=null);let c=this.allPaddedBounds;if(c&&e.minX<=c.minX&&e.minY<=c.minY&&e.maxX>=c.maxX&&e.maxY>=c.maxY)return this.rememberSelection(s,this.allPaddedRuns,this.allPaddedRuns===r?null:this.nonemptyFlags);let l=0,u=this.paddedBounds;(!this.selectedFlags||this.selectedFlags.length!==r.length)&&(this.selectedFlags=new Uint8Array(r.length));let d=this.selectedFlags;d.fill(0);for(let t=0;t<r.length;t++){let n=t*4,i=u[n],a=u[n+1],o=u[n+2],s=u[n+3];i>o||a>s||o<e.minX||s<e.minY||i>e.maxX||a>e.maxY||(d[t]=1,this.visible[l++]=r[t])}return this.visible.length=l,this.rememberSelection(s,l===r.length?r:this.visible,l===r.length?null:d)}rememberSelection(e,t,n){return this.guardBounds=e,this.guardRuns=t,this.guardFlags=this.selected=n,t}};function Yi(e,t,n,r){let i=r*4,a=Math.SQRT2*Math.max(0,n.styles[i]),o=!!(Math.floor(n.primitiveMeta[i+3]/2+1e-6)&4),s=o?n.primitiveBounds[i]:Math.min(n.endpoints[i],n.endpoints[i+2],n.primitiveMeta[i])-a,c=o?n.primitiveBounds[i+1]:Math.min(n.endpoints[i+1],n.endpoints[i+3],n.primitiveMeta[i+1])-a,l=o?n.primitiveBounds[i+2]:Math.max(n.endpoints[i],n.endpoints[i+2],n.primitiveMeta[i])+a,u=o?n.primitiveBounds[i+3]:Math.max(n.endpoints[i+1],n.endpoints[i+3],n.primitiveMeta[i+1])+a;e[t]=Math.min(e[t],s),e[t+1]=Math.min(e[t+1],c),e[t+2]=Math.max(e[t+2],l),e[t+3]=Math.max(e[t+3],u)}function Xi(e,t,n,r,i){let a=e/(2*Math.max(i,1e-6)),o=t/(2*Math.max(i,1e-6));return{minX:n-a,minY:r-o,maxX:n+a,maxY:r+o}}function Zi(e,t){e[0]=Math.max(e[0],t[0]),e[1]=Math.max(e[1],t[1]),e[2]=Math.min(e[2],t[2]),e[3]=Math.min(e[3],t[3])}var Qi=[`Normal`,`Multiply`,`Screen`,`Overlay`,`Darken`,`Lighten`,`ColorDodge`,`ColorBurn`,`HardLight`,`SoftLight`,`Difference`,`Exclusion`,`Hue`,`Saturation`,`Color`,`Luminosity`];function $i(e){if(e.paintGraph===void 0)return;if(!e.paintGraph||!Array.isArray(e.paintGraph.roots)||!e.drawRuns)throw TypeError(`Invalid PDF paint graph.`);let t=new Set,n=new Uint8Array(e.drawRuns.length),r=new Set,i=0,a=(o,s)=>{if(!Array.isArray(o)||s>64)throw RangeError(`Invalid PDF paint graph nesting.`);for(let c of o){if(!c||typeof c!=`object`||t.has(c)||++i>1e6)throw TypeError(`Invalid cyclic or oversized PDF paint graph.`);if(t.add(c),c.optionalContent!==void 0&&(!Number.isSafeInteger(c.optionalContent)||c.optionalContent<0||c.optionalContent>=(e.optionalContent?.conditions.length??0)))throw RangeError(`Invalid PDF paint graph visibility condition.`);if(c.kind===`draw`){if(!Number.isSafeInteger(c.runIndex)||c.runIndex<0||c.runIndex>=n.length||n[c.runIndex])throw RangeError(`PDF paint graph repeats or references an unknown draw run.`);n[c.runIndex]=1}else if(c.kind===`retained`){let t=e.retainedPages?.[c.retainedPage]?.page,i=t?.displayProgram.groups[t.displayProgram.rootGroupIndex].commands;if(!Number.isSafeInteger(c.retainedPage)||c.retainedPage<0||!i||!Number.isSafeInteger(c.firstCommand)||c.firstCommand<0||!Number.isSafeInteger(c.count)||c.count<=0||c.firstCommand+c.count>i.length||!Number.isSafeInteger(c.rasterIndex)||c.rasterIndex<0||c.rasterIndex>=e.rasterLayers.length)throw RangeError(`Invalid retained PDF paint graph reference.`);let a=e.drawRuns.findIndex(e=>e.kind===`raster`&&e.first===c.rasterIndex&&e.count===1);if(a<0||n[a]||r.has(c.rasterIndex))throw RangeError(`Retained PDF paint must own a unique singleton raster draw run.`);r.add(c.rasterIndex),n[a]=1}else if(c.kind===`group`){if(!Number.isFinite(c.alpha)||c.alpha<0||c.alpha>1||typeof c.isolated!=`boolean`||typeof c.knockout!=`boolean`||!Qi.includes(c.blendMode)||c.alphaIsShape!==void 0&&typeof c.alphaIsShape!=`boolean`)throw TypeError(`Invalid PDF composite group.`);if(c.bounds&&(![c.bounds.minX,c.bounds.minY,c.bounds.maxX,c.bounds.maxY].every(Number.isFinite)||c.bounds.minX>c.bounds.maxX||c.bounds.minY>c.bounds.maxY))throw RangeError(`Invalid PDF group bounds.`);if(c.softMask){let e=c.softMask;if(e.subtype!==`Alpha`&&e.subtype!==`Luminosity`)throw TypeError(`Invalid PDF mask subtype.`);if(e.transfer&&(!(e.transfer instanceof Float32Array)||e.transfer.length<2||e.transfer.length>65536||!e.transfer.every(e=>Number.isFinite(e)&&e>=0&&e<=1)))throw TypeError(`Invalid PDF mask transfer function.`);if(e.backdrop&&(!Array.isArray(e.backdrop)||e.backdrop.length!==3||!e.backdrop.every(e=>Number.isFinite(e)&&e>=0&&e<=1)))throw TypeError(`Invalid PDF mask backdrop.`);a(e.children,s+1)}a(c.children,s+1)}else throw TypeError(`Unknown PDF paint graph node.`)}};if(a(e.paintGraph.roots,0),n.some(e=>e!==1))throw RangeError(`PDF paint graph omits a canonical draw run.`)}function ea(e){if(!e.paintGraph||!e.drawRuns)return null;let t=new Uint8Array(e.drawRuns.length),n=e=>{let r=-1;for(let i of e){if(i.kind===`draw`){r>=0&&i.runIndex===r+1&&(t[r]=1),r=i.runIndex;continue}r=-1,i.kind===`group`&&(i.softMask&&n(i.softMask.children),n(i.children))}};return n(e.paintGraph.roots),t}function ta(e,t){let n=[],r=0,i=(a,o)=>{if(o>64)throw RangeError(`PDF paint graph nesting exceeds 64 groups.`);for(let s of a)if(t(s.optionalContent)){if(s.kind===`draw`){let r=e.drawRuns?.[s.runIndex];if(!r)throw RangeError(`PDF paint graph references an unknown draw run.`);t(r.optionalContent)&&n.push({kind:`draw`,runIndex:s.runIndex})}else if(s.kind===`retained`)n.push({kind:`retained`,node:s});else{let e=r++;n.push({kind:`begin-group`,id:e,node:s}),s.softMask&&(n.push({kind:`begin-mask`,id:e,mask:s.softMask}),i(s.softMask.children,o+1),n.push({kind:`end-mask`,id:e})),i(s.children,o+1),n.push({kind:`end-group`,id:e})}}};return e.paintGraph?i(e.paintGraph.roots,0):e.drawRuns?.forEach((e,r)=>{t(e.optionalContent)&&n.push({kind:`draw`,runIndex:r})}),n}var na=new WeakMap;function ra(e,t,n){if(n>64)return!1;for(let r of t)if(r.kind===`group`){if(r.knockout||r.blendMode!==`Normal`||!ra(e,r.children,n+1))return!1}else if(r.kind===`draw`&&e.drawRuns?.[r.runIndex]?.blendMode)return!1;return!0}function ia(e){if(!e.paintGraph)return[];let t=na.get(e);if(t)return t;let n=(t,r,i)=>{let a=[];for(let o of t){if(o.kind!==`group`||r>=64){a.push(o);continue}let t=!o.knockout&&ra(e,o.children,0),s=n(o.children,r+1,o.knockout);if(!i&&o.alpha===1&&!o.softMask&&!o.knockout&&o.blendMode===`Normal`&&(!o.isolated||t)&&(o.optionalContent===void 0||s.every(e=>e.optionalContent===void 0||e.optionalContent===o.optionalContent))){for(let e of s)a.push(o.optionalContent!==void 0&&e.optionalContent===void 0?{...e,optionalContent:o.optionalContent}:e);continue}let c=o.softMask?{...o.softMask,children:n(o.softMask.children,r+1,!1)}:void 0;a.push({...o,children:s,softMask:c,isolated:o.isolated||t})}return a},r=n(e.paintGraph.roots,0,!1);return na.set(e,r),r}var aa=new WeakMap;function oa(e){if(!e.paintGraph||!e.drawRuns)return null;let t=aa.get(e);if(t)return t;let n=e.drawRuns,r=new Uint32Array(n.length),i=new Map;n.forEach((e,t)=>{e.kind===`raster`&&e.count===1&&i.set(e.first,t)});let a=0,o=(e,t,s=!1)=>{if(!(t>64)){a++;for(let c of e){if(c.kind===`group`){a++,c.softMask&&o(c.softMask.children,t+1),o(c.children,t+1,c.knockout),a++;continue}let e=c.kind===`draw`?c.runIndex:i.get(c.rasterIndex);e===void 0||e>=n.length||(s||n[e].blendMode?(a++,r[e]=a,a++):r[e]=a)}a++}};return o(ia(e),0),aa.set(e,r),r}var sa=new WeakMap,ca={minX:-1/0,minY:-1/0,maxX:1/0,maxY:1/0};function la(e){let t=sa.get(e);if(t)return t;let n={nodes:new Map,runs:null},r=e.drawRuns;if(!r||!e.paintGraph)return sa.set(e,n),n;let i;try{i=new Ji(e)}catch{return sa.set(e,n),n}let a=[0,0,0,0],o=new Float64Array(r.length*4),s=new Map;r.forEach((e,t)=>{e.kind===`raster`&&e.count===1&&s.set(e.first,t)});let c=(e,t)=>{if(t>64)return ca;let l={minX:1/0,minY:1/0,maxX:-1/0,maxY:-1/0},u=e=>{l.minX=Math.min(l.minX,e.minX),l.minY=Math.min(l.minY,e.minY),l.maxX=Math.max(l.maxX,e.maxX),l.maxY=Math.max(l.maxY,e.maxY)};for(let n of e){if(n.kind===`group`){n.softMask&&c(n.softMask.children,t+1),u(c(n.children,t+1));continue}let e=n.kind===`draw`?n.runIndex:s.get(n.rasterIndex);if(!(e===void 0||e>=r.length)){try{i.getBounds(e,0,a)}catch{u(ca);continue}if(a.some(e=>Number.isNaN(e))){u(ca);continue}o.set(a,e*4),u({minX:a[0],minY:a[1],maxX:a[2],maxY:a[3]})}}return n.nodes.set(e,l),l};return o.fill(1/0),c(ia(e),0),n.runs=o,sa.set(e,n),n}var ua=[`stroke`,`fill`,`text`,`raster`,`gradient-fill`,`gradient-stroke`],da=ua.length*2;function fa(e){return{stroke:e.segmentCount,fill:e.fillPathCount,text:e.textInstanceCount,raster:e.rasterLayers.length,"gradient-fill":e.gradientFillPathCount,"gradient-stroke":e.gradientStrokeRunCount}}function pa(e){let t=e.pagePrimitiveRanges;if(t===void 0)return;let n=e.pageRects.length/4,r=fa(e);if(!(t instanceof Uint32Array)||t.length!==n*da)throw RangeError(`Invalid page primitive ranges.`);ua.forEach((e,i)=>{let a=0;for(let o=0;o<n;o++){let n=o*da+i*2;if(t[n]!==a||t[n+1]>r[e]-a)throw RangeError(`Page primitive ranges overlap, omit, or exceed their store.`);a+=t[n+1]}if(a!==r[e])throw RangeError(`Page primitive ranges do not cover their store.`)})}var ma=class{pageCount;owners;indices;pageRuns=null;scene;constructor(e){if(this.scene=e,this.pageCount=Math.floor(e.pageRects.length/4),this.pageCount<1)throw RangeError(`The scene has no pages.`);pa(e);let t=fa(e);this.owners={},this.indices={};let n=0;for(let[r,i]of ua.entries()){let a=this.owners[i]=new Uint32Array(t[i]),o=this.indices[i]=Array.from({length:this.pageCount},()=>[]);if(e.pagePrimitiveRanges)for(let t=0;t<this.pageCount;t++){let n=t*da+r*2;a.fill(t,e.pagePrimitiveRanges[n],e.pagePrimitiveRanges[n]+e.pagePrimitiveRanges[n+1])}else if(i===`text`)for(let t=0;t<this.pageCount;t++)a.fill(t,e.pageTextRanges[t*2],e.pageTextRanges[t*2]+e.pageTextRanges[t*2+1]);else for(let r=0;r<t[i];r++)if(i===`raster`)a[r]=e.rasterLayers[r].pageIndex??0;else if(i===`gradient-fill`)a[r]=e.gradientFillPaintMeta[r*4+3];else if(i===`gradient-stroke`)a[r]=e.gradientStrokeRunMetaB[r*4+1];else if(this.pageCount>1){let t=r*4,[o,s,c,l]=i===`stroke`?[e.primitiveBounds[t],e.primitiveBounds[t+1],e.primitiveBounds[t+2],e.primitiveBounds[t+3]]:[e.fillPathMetaA[t+2],e.fillPathMetaA[t+3],e.fillPathMetaB[t],e.fillPathMetaB[t+1]],u=a[r]=this.pageAt((o+c)/2,(s+l)/2),d=e.pageRects,f=u*4;o>=Math.min(d[f],d[f+2])&&c<=Math.max(d[f],d[f+2])&&s>=Math.min(d[f+1],d[f+3])&&l<=Math.max(d[f+1],d[f+3])||n++}for(let e=0;e<a.length;e++){if(a[e]>=this.pageCount)throw RangeError(`Primitive references an unknown page.`);o[a[e]].push(e)}}n&&console.warn(`[HEPR] This scene has no exact page primitive ranges, so independent page views infer stroke/fill ownership from the original layout. ${n.toLocaleString()} stroke/fill primitive(s) reach past their nearest page and may be assigned approximately. Exporting the HEP again stores exact ownership.`)}runsOnPage(e,t){if(!this.pageRuns){let e=Array.from({length:this.pageCount},()=>[]);t.forEach((t,n)=>{let r=this.owners[t.kind],i=-1;for(let a=t.first;a<t.first+t.count;a++){let t=r[a];if(t===i)continue;let o=e[t];o[o.length-1]!==n&&o.push(n),i=t}}),this.pageRuns=e}return this.pageRuns[e]}pageAt(e,t){let n=0,r=1/0;for(let i=0;i<this.pageCount;i++){let a=this.scene.pageRects,o=i*4,s=Math.max(Math.min(a[o],a[o+2])-e,0,e-Math.max(a[o],a[o+2])),c=Math.max(Math.min(a[o+1],a[o+3])-t,0,t-Math.max(a[o+1],a[o+3])),l=s*s+c*c;l<r&&(n=i,r=l)}return n}extract(e){if(!Number.isInteger(e)||e<0||e>=this.pageCount)throw RangeError(`Invalid page index.`);let t=this.scene,n=Object.fromEntries(ua.map(t=>[t,Uint32Array.from(this.indices[t][e])])),r=Object.fromEntries(ua.map(e=>[e,new Map(Array.from(n[e],(e,t)=>[e,t]))])),i={...t,pageCount:1,pagesPerRow:1,pageRects:t.pageRects.slice(e*4,e*4+4),pagePrimitiveRanges:void 0,textIndex:null,retainedPages:void 0,paintGraph:void 0,clipPaths:void 0},a=i.pageRects;i.pageBounds={minX:Math.min(a[0],a[2]),minY:Math.min(a[1],a[3]),maxX:Math.max(a[0],a[2]),maxY:Math.max(a[1],a[3])},i.bounds={...i.pageBounds};let o=(e,n,r=4)=>{let i=t[e],a=new Float32Array(n.length*r);for(let e=0;e<n.length;e++)a.set(i.subarray(n[e]*r,(n[e]+1)*r),e*r);return a};for(let e of[`endpoints`,`primitiveMeta`,`primitiveBounds`,`styles`])i[e]=o(e,n.stroke);i.segmentCount=i.sourceSegmentCount=i.mergedSegmentCount=n.stroke.length,i.maxHalfWidth=0;for(let e=0;e<i.styles.length;e+=4)i.maxHalfWidth=Math.max(i.maxHalfWidth,i.styles[e]);let s=(e,t,n,r)=>{let a=o(t,e),s=[];for(let t=0;t<e.length;t++){let e=a[t*4],n=a[t*4+1];a[t*4]=s.length;for(let t=0;t<n;t++)s.push(e+t)}return i[t]=a,i[n]=o(n,s),i[r]=o(r,s),s.length};i.fillPathCount=n.fill.length,i.fillSegmentCount=s(n.fill,`fillPathMetaA`,`fillSegmentsA`,`fillSegmentsB`),i.fillPathMetaB=o(`fillPathMetaB`,n.fill),i.fillPathMetaC=o(`fillPathMetaC`,n.fill),i.gradientFillPathCount=n[`gradient-fill`].length,i.gradientFillSegmentCount=s(n[`gradient-fill`],`gradientFillPathMetaA`,`gradientFillSegmentsA`,`gradientFillSegmentsB`);for(let e of[`gradientFillPathMetaB`,`gradientFillPathMetaC`,`gradientFillPaintMeta`])i[e]=o(e,n[`gradient-fill`]);i.gradientStrokeRunCount=n[`gradient-stroke`].length,i.gradientStrokeRunMetaA=o(`gradientStrokeRunMetaA`,n[`gradient-stroke`]),i.gradientStrokeRunMetaB=o(`gradientStrokeRunMetaB`,n[`gradient-stroke`]);let c=[];for(let e=0;e<i.gradientStrokeRunCount;e++){let t=i.gradientStrokeRunMetaA[e*4],n=i.gradientStrokeRunMetaA[e*4+1];i.gradientStrokeRunMetaA[e*4]=c.length,i.gradientStrokeRunMetaB[e*4+1]=0;for(let e=0;e<n;e++)c.push(t+e)}i.gradientStrokeSegmentCount=c.length;for(let e of[`gradientStrokeEndpoints`,`gradientStrokePrimitiveMeta`,`gradientStrokePrimitiveBounds`,`gradientStrokeStyles`])i[e]=o(e,c);let l=[],u=new Map,d=e=>e<0?-1:(u.has(e)||(u.set(e,l.length),l.push(e)),u.get(e));for(let e=0;e<i.gradientFillPaintMeta.length;e+=4)i.gradientFillPaintMeta[e]=d(i.gradientFillPaintMeta[e]),i.gradientFillPaintMeta[e+1]=d(i.gradientFillPaintMeta[e+1]),i.gradientFillPaintMeta[e+3]=0;for(let e=0;e<i.gradientStrokeRunMetaA.length;e+=4)i.gradientStrokeRunMetaA[e+2]=d(i.gradientStrokeRunMetaA[e+2]),i.gradientStrokeRunMetaA[e+3]=d(i.gradientStrokeRunMetaA[e+3]);i.gradientCount=l.length;for(let e of[`gradientMetaA`,`gradientMetaB`,`gradientMetaC`,`gradientMetaD`,`gradientMetaE`])i[e]=o(e,l);let f=t.gradientCount?t.gradientLut.length/t.gradientCount:0;i.gradientLut=new Uint8Array(l.length*f),l.forEach((e,n)=>i.gradientLut.set(t.gradientLut.subarray(e*f,(e+1)*f),n*f)),ha(t,i,l),i.textInstanceCount=i.sourceTextCount=i.textInPageCount=n.text.length,i.textOutOfPageCount=0,i.textInstanceA=o(`textInstanceA`,n.text),i.textInstanceB=o(`textInstanceB`,n.text),i.textInstanceC=o(`textInstanceC`,n.text);let p=[],m=new Map;for(let e=0;e<i.textInstanceB.length;e+=4){let t=i.textInstanceB[e+3]-1;t>=0&&(m.has(t)||(m.set(t,p.length),p.push(t)),i.textInstanceB[e+3]=m.get(t)+1)}i.textClipRects=p.length?o(`textClipRects`,p):void 0,i.pageTextRanges=Uint32Array.of(0,i.textInstanceCount);let h=t.textIndex?.pages[e];h&&(i.textIndex={version:2,pages:[{...h,charInstance:Int32Array.from(h.charInstance,e=>e<0?e:r.text.get(e)??-1)}]}),i.textContent=t.textContent?.filter(t=>t.pageIndex===e).map(e=>({...e,pageIndex:0})),i.annotations=t.annotations?.filter(t=>t.pageIndex===e).map(e=>({...e,pageIndex:0})),i.pdfPages=t.pdfPages?.filter(t=>t.pageIndex===e).map(e=>({...e,pageIndex:0}));let g=Vn(t,n);g?i.markedContent=g:delete i.markedContent,i.rasterLayers=Array.from(n.raster,e=>({...t.rasterLayers[e],pageIndex:0}));let _=i.rasterLayers[0];i.rasterLayerWidth=_?.width??0,i.rasterLayerHeight=_?.height??0,i.rasterLayerData=_?.data??new Uint8Array,i.rasterLayerMatrix=_?.matrix??Float32Array.of(1,0,0,1,0,0),i.imagePaintOpCount=i.rasterLayers.length;let v=t.drawRuns??Mn(t),y=new Map;i.drawRuns=[];let b=new Map;i.clipPaths=[];let x=e=>{if(b.has(e))return b.get(e);let n=t.clipPaths[e],r=n.parent<0?-1:x(n.parent),a=i.clipPaths.length;return b.set(e,a),i.clipPaths.push({...n,parent:r}),a};for(let t of this.runsOnPage(e,v)){let e=v[t],r=n[e.kind],a=ga(r,e.first),o=ga(r,e.first+e.count);if(a===o)continue;let s={...e,first:a,count:o-a,...e.clipIndex===void 0?{}:{clipIndex:x(e.clipIndex)}};y.set(t,[i.drawRuns.length]),i.drawRuns.push(s)}let S=new Map,C=e=>e.flatMap(e=>{if(e.kind===`draw`)return(y.get(e.runIndex)??[]).map(t=>({...e,runIndex:t}));if(e.kind===`retained`){let n=r.raster.get(e.rasterIndex);return n===void 0?[]:(i.retainedPages??=[],S.has(e.retainedPage)||(S.set(e.retainedPage,i.retainedPages.length),i.retainedPages.push(t.retainedPages[e.retainedPage])),[{...e,rasterIndex:n,retainedPage:S.get(e.retainedPage)}])}let n=C(e.children);return n.length?[{...e,children:n,...e.softMask?{softMask:{...e.softMask,children:C(e.softMask.children)}}:{}}]:[]});t.paintGraph&&(i.paintGraph={roots:C(t.paintGraph.roots)});let w={minX:1/0,minY:1/0,maxX:-1/0,maxY:-1/0},T=e=>{w.minX=Math.min(w.minX,e.minX),w.minY=Math.min(w.minY,e.minY),w.maxX=Math.max(w.maxX,e.maxX),w.maxY=Math.max(w.maxY,e.maxY),i.bounds.minX=Math.min(i.bounds.minX,e.minX),i.bounds.minY=Math.min(i.bounds.minY,e.minY),i.bounds.maxX=Math.max(i.bounds.maxX,e.maxX),i.bounds.maxY=Math.max(i.bounds.maxY,e.maxY)},E=new Ji(i),D=[0,0,0,0];for(let e=0;e<i.drawRuns.length;e++){let t=i.drawRuns[e].kind;t!==`gradient-fill`&&t!==`gradient-stroke`&&(E.getBounds(e,0,D),D.every(Number.isFinite)&&D[0]<=D[2]&&D[1]<=D[3]&&T({minX:D[0],minY:D[1],maxX:D[2],maxY:D[3]}))}for(let e=0;e<i.gradientFillPathCount*4;e+=4)T({minX:i.gradientFillPathMetaA[e+2],minY:i.gradientFillPathMetaA[e+3],maxX:i.gradientFillPathMetaB[e],maxY:i.gradientFillPathMetaB[e+1]});for(let e=0;e<i.gradientStrokeSegmentCount*4;e+=4){let t=i.gradientStrokeEndpoints,n=i.gradientStrokePrimitiveMeta,r=Math.SQRT2*Math.max(0,i.gradientStrokeStyles[e]);T({minX:Math.min(t[e],t[e+2],n[e])-r,minY:Math.min(t[e+1],t[e+3],n[e+1])-r,maxX:Math.max(t[e],t[e+2],n[e])+r,maxY:Math.max(t[e+1],t[e+3],n[e+1])+r})}return i.pathCount=i.fillPathCount+i.gradientFillPathCount,i.pagePrimitiveRanges=Uint32Array.from(ua.flatMap(e=>[0,n[e].length])),Nn(i),$i(i),{scene:i,paintBounds:w,primitives:n,pageIndex:e}}localRef(e,t){let n=e.primitives[t.kind],r=0,i=n.length;for(;r<i;){let e=r+i>>>1;n[e]<t.index?r=e+1:i=e}return n[r]===t.index?{kind:t.kind,index:r}:null}};function ha(e,t,n){if(t.gradientMeshRanges=void 0,t.gradientMeshPositions=void 0,t.gradientMeshColors=void 0,t.gradientMeshIndices=void 0,!e.gradientMeshRanges||!e.gradientMeshIndices)return;let r=new Uint32Array(n.length*2),i=[],a=[],o=[],s=new Map;n.forEach((t,n)=>{let c=e.gradientMeshRanges[t*2],l=e.gradientMeshRanges[t*2+1];r[n*2]=o.length,r[n*2+1]=l;for(let t=c;t<c+l;t++){let n=e.gradientMeshIndices[t];s.has(n)||(s.set(n,s.size),i.push(...e.gradientMeshPositions.subarray(n*2,n*2+2)),a.push(...e.gradientMeshColors.subarray(n*4,n*4+4))),o.push(s.get(n))}}),t.gradientMeshRanges=r,t.gradientMeshPositions=Float32Array.from(i),t.gradientMeshColors=Float32Array.from(a),t.gradientMeshIndices=Uint32Array.from(o)}function ga(e,t){let n=0,r=e.length;for(;n<r;){let i=n+r>>>1;e[i]<t?n=i+1:r=i}return n}function _a(){return{pageCount:0,pagesPerRow:1,pageRects:new Float32Array,pageTextRanges:new Uint32Array,textIndex:null,fillPathCount:0,fillSegmentCount:0,fillPathMetaA:new Float32Array,fillPathMetaB:new Float32Array,fillPathMetaC:new Float32Array,fillSegmentsA:new Float32Array,fillSegmentsB:new Float32Array,gradientCount:0,gradientMetaA:new Float32Array,gradientMetaB:new Float32Array,gradientMetaC:new Float32Array,gradientMetaD:new Float32Array,gradientMetaE:new Float32Array,gradientLut:new Uint8Array,gradientFillPathCount:0,gradientFillSegmentCount:0,gradientFillPathMetaA:new Float32Array,gradientFillPathMetaB:new Float32Array,gradientFillPathMetaC:new Float32Array,gradientFillPaintMeta:new Float32Array,gradientFillSegmentsA:new Float32Array,gradientFillSegmentsB:new Float32Array,gradientStrokeRunCount:0,gradientStrokeSegmentCount:0,gradientStrokeRunMetaA:new Float32Array,gradientStrokeRunMetaB:new Float32Array,gradientStrokeEndpoints:new Float32Array,gradientStrokePrimitiveMeta:new Float32Array,gradientStrokePrimitiveBounds:new Float32Array,gradientStrokeStyles:new Float32Array,segmentCount:0,sourceSegmentCount:0,mergedSegmentCount:0,sourceTextCount:0,textInstanceCount:0,textGlyphCount:0,textGlyphSegmentCount:0,textInPageCount:0,textOutOfPageCount:0,textInstanceA:new Float32Array,textInstanceB:new Float32Array,textInstanceC:new Float32Array,textGlyphMetaA:new Float32Array,textGlyphMetaB:new Float32Array,textGlyphSegmentsA:new Float32Array,textGlyphSegmentsB:new Float32Array,rasterLayers:[],rasterLayerWidth:0,rasterLayerHeight:0,rasterLayerData:new Uint8Array,rasterLayerMatrix:new Float32Array([1,0,0,1,0,0]),endpoints:new Float32Array,primitiveMeta:new Float32Array,primitiveBounds:new Float32Array,styles:new Float32Array,bounds:{minX:0,minY:0,maxX:1,maxY:1},pageBounds:{minX:0,minY:0,maxX:1,maxY:1},maxHalfWidth:0,imagePaintOpCount:0,pathCount:0,discardedTransparentCount:0,discardedDegenerateCount:0,discardedDuplicateCount:0,discardedContainedCount:0}}var va=class e{enabled;root;start;end;fixedMeta;constructor(e,t={}){this.root=t.root??{callback:e,throttleMs:t.throttleMs??80,minDelta:t.minDelta??.002,lastEmittedValue:-1,lastEmittedAt:0},this.start=xa(t.start??0),this.end=xa(t.end??1),this.fixedMeta=t.fixedMeta??{},this.enabled=typeof this.root.callback==`function`}child(t,n,r={}){let i=Ca(this.start,this.end,xa(t)),a=Ca(this.start,this.end,xa(n));return new e(void 0,{start:i,end:a,root:this.root,fixedMeta:{...this.fixedMeta,...r}})}toCallback(){return e=>{this.report(e.value,e)}}report(e,t={}){if(!this.enabled)return;let n={...this.fixedMeta,...t},r=xa(e),i=Ca(this.start,this.end,r),a=Math.max(this.root.lastEmittedValue,i),o=n.stage??this.fixedMeta.stage??this.root.lastStage??`source`,s=wa(),c=a-this.root.lastEmittedValue,l=o!==this.root.lastStage;if(!(this.root.lastEmittedValue<0||a>=1||l||c>=this.root.minDelta||s-this.root.lastEmittedAt>=this.root.throttleMs))return;let u={value:xa(a),stage:o,executionPath:n.executionPath,sourceType:n.sourceType,unit:n.unit,processed:n.processed,total:n.total,pageIndex:n.pageIndex,pageCount:n.pageCount,sourcePageIndex:n.sourcePageIndex,sourcePageCount:n.sourcePageCount};this.root.lastEmittedValue=u.value,this.root.lastEmittedAt=s,this.root.lastStage=u.stage,this.root.callback?.(u)}complete(e={}){this.report(1,{stage:`complete`,...e})}async withIndeterminateProgress(e,t){if(!this.enabled)return typeof e==`function`?e():e;let n=Math.max(50,Math.trunc(t.tickMs??90)),r=Sa(t.ceiling??.9,.1,.999),i=Math.max(1,Number.isFinite(t.timeConstantMs)?t.timeConstantMs:800),a=wa(),o={stage:t.stage,executionPath:t.executionPath,sourceType:t.sourceType,unit:t.unit,processed:t.processed,total:t.total,pageIndex:t.pageIndex,pageCount:t.pageCount,sourcePageIndex:t.sourcePageIndex,sourcePageCount:t.sourcePageCount};this.report(0,o);let s=globalThis.setInterval(()=>{let e=Math.max(0,wa()-a)/i;this.report(Math.min(r,r*(1-1/(1+e))),o)},n);try{let t=await(typeof e==`function`?e():e);return this.report(1,o),t}finally{globalThis.clearInterval(s)}}};function ya(e,t={}){return new va(e,t)}function ba(e){switch(e){case`source`:return`Reading source`;case`pdf-page`:return`Processing pages`;case`pdf-operators`:return`Scanning operators`;case`pdf-optimize`:return`Optimizing geometry`;case`pdf-text`:return`Extracting text`;case`pdf-raster`:return`Extracting rasters`;case`compile`:return`Compiling`;case`hep-open`:return`Opening HEP`;case`hep-manifest`:return`Reading manifest`;case`hep-section`:return`Decoding HEP`;case`raster-encode`:return`Compressing raster images`;case`hep-build`:return`Building HEP`;case`vector-lod`:return`Building Vector LOD`;case`vector-lod-restore`:return`Loading Vector LOD`;case`text-lod`:return`Building Text LOD`;case`upload`:return`Uploading`;case`first-render`:return`Rendering first frame`;case`complete`:return`Complete`;default:return`Parsing / loading`}}function xa(e){return Sa(e,0,1)}function Sa(e,t,n){return!Number.isFinite(e)||e<t?t:e>n?n:e}function Ca(e,t,n){return e+(t-e)*n}function wa(){return typeof performance<`u`&&typeof performance.now==`function`?performance.now():Date.now()}var Ta=Object.freeze({maxIncrementalRevisions:128,maxRecursionDepth:64,maxDecodedStreamBytes:536870912,maxObjectStreamCacheBytes:536870912,maxRepairScanBytes:536870912,maxRepairCandidates:2e6,maxCachedObjects:16384,maxSourceCacheBytes:33554432,maxImageDimension:65535,maxImagePixels:268435456,maxIccProfileBytes:67108864,maxIccTransformBytes:16777216,maxCommandsPerPage:1e7,maxPathsPerPage:5e6,maxPathVerbsPerPage:2e7,maxPathCoordinatesPerPage:6e7,maxClipsPerPage:1e6,maxStrokeStylesPerPage:5e6,maxDashValuesPerPage:2e7,maxGlyphsPerPage:1e7}),Ea=class extends Error{code;offset;objectNumber;pageIndex;details;constructor(e,t,n={}){super(t,n.cause===void 0?void 0:{cause:n.cause}),this.name=`PdfError`,this.code=e,this.offset=n.offset,this.objectNumber=n.objectNumber,this.pageIndex=n.pageIndex,this.details=n.details}};function Da(e){if(!e)return Ta;let t={...Ta,...e};for(let[e,n]of Object.entries(t))if(!Number.isSafeInteger(n)||n<=0)throw RangeError(`PDF resource limit ${e} must be a positive safe integer.`);return Object.freeze(t)}function Oa(e){if(e?.aborted)throw new Ea(`aborted`,`The PDF operation was aborted.`,{cause:e.reason})}function ka(e){if(e!==void 0&&e!==`qcms`&&e!==`lcms`&&e!==`alternate`&&e!==`none`)throw TypeError(`iccEngine must be "qcms", "lcms", "alternate", or "none".`);return e??`qcms`}function Aa(e,t,n){return e.map((e,r)=>{let i=t[r*2],a=t[r*2+1],o=Math.max(i,Math.min(a,e));return n===2?a===i?0:(o-i)/(a-i):n===4?r===0?o/100:(o+128)/255:o})}var ja=Object.freeze({1:256,3:33,4:17}),Ma=16777216;function Na(e,t,n,r=Ma,i){Oa(i);let a=ja[n],o=Ra(n,a,r),s,c;try{s=new Uint8Array(e.byteLength),s.set(e),c=new Uint8Array(o.inputBytes)}catch(t){throw new Ea(`resource-limit`,`Unable to allocate an ICC transform request.`,{cause:t,details:{profileBytes:e.byteLength,inputBytes:o.inputBytes}})}for(let e=0;e<o.sampleCount;e+=1){e&4095||Oa(i);let t=e,r=e*n;for(let e=n-1;e>=0;--e){let n=t%a;t=Math.floor(t/a),c[r+e]=Math.round(n*255/(a-1))}}return Oa(i),Object.freeze({profile:s,metadata:Object.freeze({...t}),inputComponents:n,gridPointsPerComponent:a,sampleCount:o.sampleCount,inputSamples:c,renderingIntent:`relative-colorimetric`})}async function Pa(e,t,n=Ma,r){Fa(t,n),Oa(r);let i;try{i=await e(t,r)}catch(e){throw Oa(r),e instanceof Ea?e:new Ea(`unsupported-color`,`The ICC transform resolver failed.`,{cause:e,details:{reason:`icc-transform-resolver-failed`}})}return Oa(r),Ia(i,t,n,r)}function Fa(e,t=Ma){if(!e||typeof e!=`object`||!(e.profile instanceof Uint8Array)||!(e.inputSamples instanceof Uint8Array)||!Ba(e.inputComponents)||e.renderingIntent!==`relative-colorimetric`||!e.metadata||typeof e.metadata!=`object`)throw za(`The ICC transform request is malformed.`);let n=Ra(e.inputComponents,e.gridPointsPerComponent,t);if(e.sampleCount!==n.sampleCount||e.inputSamples.byteLength!==n.inputBytes)throw za(`The ICC transform request has an inconsistent sample layout.`,{expectedSamples:n.sampleCount,actualSamples:e.sampleCount,expectedBytes:n.inputBytes,actualBytes:e.inputSamples.byteLength});if(!Number.isSafeInteger(e.metadata.declaredSize)||e.metadata.declaredSize!==e.profile.byteLength||!Number.isSafeInteger(e.metadata.versionMajor)||e.metadata.versionMajor<0||e.metadata.versionMajor>255||!Va(e.metadata.preferredCmm)||!Va(e.metadata.deviceClass)||!Va(e.metadata.dataColorSpace)||!Va(e.metadata.connectionSpace))throw za(`The ICC transform request has invalid profile metadata.`)}function Ia(e,t,n=Ma,r){Oa(r);let i=Ra(t.inputComponents,t.gridPointsPerComponent,n);if(!e||typeof e!=`object`||!(e.samples instanceof Uint8Array)||e.sampleCount!==i.sampleCount||e.outputComponents!==3||e.bitsPerComponent!==8||e.samples.byteLength!==i.outputBytes)throw za(`The ICC transform resolver returned an invalid result.`,{expectedSamples:i.sampleCount,actualSamples:Ha(e?.sampleCount),expectedBytes:i.outputBytes,actualBytes:e?.samples instanceof Uint8Array?e.samples.byteLength:-1},`invalid-icc-transform-result`);let a;try{a=new Uint8Array(e.samples.byteLength),a.set(e.samples)}catch(e){throw new Ea(`resource-limit`,`Unable to copy the ICC transform result.`,{cause:e,details:{bytes:i.outputBytes}})}return Oa(r),Object.freeze({samples:a,sampleCount:i.sampleCount,outputComponents:3,bitsPerComponent:8})}function La(e,t,n,r){if(Oa(r),n.length!==t||n.some(e=>!Number.isFinite(e)))throw new Ea(`unsupported-color`,`The ICC transform received an invalid component vector.`);let i=ja[t],a=Math.max(0,Math.min(1,n[0]))*(i-1),o=Math.floor(a),s=Math.min(o+1,i-1),c=a-o;if(t===1){let t=o*3,n=s*3;return[(e.samples[t]*(1-c)+e.samples[n]*c)/255,(e.samples[t+1]*(1-c)+e.samples[n+1]*c)/255,(e.samples[t+2]*(1-c)+e.samples[n+2]*c)/255]}let l=Math.max(0,Math.min(1,n[1]))*(i-1),u=Math.floor(l),d=Math.min(u+1,i-1),f=l-u,p=Math.max(0,Math.min(1,n[2]))*(i-1),m=Math.floor(p),h=Math.min(m+1,i-1),g=p-m,_=0,v=0,y=0;if(t===4){let e=Math.max(0,Math.min(1,n[3]))*(i-1);_=Math.floor(e),v=Math.min(_+1,i-1),y=e-_}let b=0,x=0,S=0,C=1<<t;for(let n=0;n<C;n+=1){let r=!!(n&1),a=!!(n&2),l=!!(n&4),p=r?s:o,C=a?d:u,w=l?h:m,T=(p*i+C)*i+w,E=(r?c:1-c)*(a?f:1-f)*(l?g:1-g);if(t===4){let e=!!(n&8);T=T*i+(e?v:_),E*=e?y:1-y}if(E===0)continue;let D=T*3;b+=e.samples[D]*E,x+=e.samples[D+1]*E,S+=e.samples[D+2]*E}return Oa(r),[b/255,x/255,S/255]}function Ra(e,t,n){if(!Ba(e))throw za(`The ICC transform component count is unsupported.`);if(!Number.isSafeInteger(t)||t<2||t>256)throw za(`The ICC transform grid size is invalid.`);if(!Number.isSafeInteger(n)||n<=0)throw RangeError(`maxIccTransformBytes must be a positive safe integer.`);let r=1;for(let n=0;n<e;n+=1)if(r*=t,!Number.isSafeInteger(r))throw new Ea(`resource-limit`,`The ICC transform sample count is too large.`);let i=r*e,a=r*3,o=i+a;if(!Number.isSafeInteger(i)||!Number.isSafeInteger(a)||!Number.isSafeInteger(o)||o>n)throw new Ea(`resource-limit`,`An ICC transform exceeds the configured byte limit.`,{details:{workingBytes:o,limit:n,reason:`icc-transform-bytes`}});return{sampleCount:r,inputBytes:i,outputBytes:a}}function za(e,t={},n=`invalid-icc-transform-request`){return new Ea(`unsupported-color`,e,{details:{reason:n,...t}})}function Ba(e){return e===1||e===3||e===4}function Va(e){return typeof e==`string`&&e.length===4}function Ha(e){return typeof e==`number`&&Number.isSafeInteger(e)?e:-1}function Ua(e,t){let n=e=>e.map(e=>{let r=e.optionalContent===void 0?{}:{optionalContent:e.optionalContent+t.condition};return e.kind===`draw`?{...e,...r,runIndex:e.runIndex+t.run}:e.kind===`retained`?{...e,...r,retainedPage:e.retainedPage+t.retainedPage,rasterIndex:e.rasterIndex+t.raster}:{...e,...r,children:n(e.children),...e.bounds?{bounds:{minX:e.bounds.minX+t.x,minY:e.bounds.minY+t.y,maxX:e.bounds.maxX+t.x,maxY:e.bounds.maxY+t.y}}:{},...e.softMask?{softMask:{...e.softMask,children:n(e.softMask.children),...e.softMask.transfer?{transfer:e.softMask.transfer.slice()}:{},...e.softMask.backdrop?{backdrop:[...e.softMask.backdrop]}:{}}}:{}}});return{roots:n(e.roots)}}function Wa(t){let n=new Map,r=new Set;for(let e of t)for(let t of e?.groups??[])t.annotationId===void 0&&r.add(t.id);let i=e-r.size,a=0,o=[],s=[],c=[],l=new Set,u=new Map,d=e=>{for(let t of e)t.kind===`group`&&l.add(t.groupId),t.children&&d(t.children)};for(let e of t){let t=o.length;if(s.push(t),!e)continue;let r=new Set;for(let t of e.groups)if(!n.has(t.id)){if(t.annotationId!==void 0&&i<=0){r.add(t.id),a++;continue}t.annotationId!==void 0&&i--,n.set(t.id,t)}for(let n of e.conditions)o.push(n.kind===`and`||n.kind===`or`?{kind:n.kind,operands:n.operands.map(e=>e+t)}:n.kind===`not`?{kind:`not`,operand:n.operand+t}:n.kind===`group`&&r.has(n.groupId)?{kind:`constant`,value:!0}:{...n});c.length||(c.push(...e.order),d(e.order));for(let t of e.radioGroups)u.set(JSON.stringify(t),[...t])}for(let e of n.values())!l.has(e.id)&&e.annotationId===void 0&&c.push({kind:`group`,groupId:e.id});return{data:n.size?{groups:[...n.values()],conditions:o,order:c,radioGroups:[...u.values()]}:void 0,offsets:s,droppedAnnotationLayers:a}}var Ga=[37,80,68,70,45],Ka=1024;function qa(e){let t=Math.min(e.length,Ka)-Ga.length;for(let n=0;n<=t;n+=1){let t=!0;for(let r=0;r<Ga.length;r+=1)if(e[n+r]!==Ga[r]){t=!1;break}if(t)return!0}return!1}function Ja(e,t={}){if(qa(e))return;let n=t.label?.trim()||`PDF source`,r=Ya(t.contentType);if(r===`text/html`||Xa(e))throw Error(`Expected PDF data for ${n}, but received HTML instead. The asset URL may have resolved to an application fallback page.`);let i=r?` (content type ${r})`:``;throw Error(`Expected PDF data for ${n}, but no %PDF- header was found in the first ${Ka.toLocaleString(`en-US`)} bytes${i}.`)}function Ya(e){return e?.split(`;`,1)[0]?.trim().toLowerCase()||null}function Xa(e){let t=Math.min(e.length,128),n=``;for(let r=0;r<t;r+=1)n+=String.fromCharCode(e[r]);let r=n.replace(/^\uFEFF/,``).trimStart().toLowerCase();return r.startsWith(`<!doctype html`)||r.startsWith(`<html`)}var Za=class{data;length=0;constructor(e=32768){this.data=new Float32Array(e*4)}get quadCount(){return this.length>>2}truncateQuads(e){this.length=Math.max(0,Math.min(this.length,Math.trunc(e)*4))}push(e,t,n,r){this.ensureCapacity(4);let i=this.length;this.data[i]=e,this.data[i+1]=t,this.data[i+2]=n,this.data[i+3]=r,this.length+=4}append(e,t,n){n<=0||(this.ensureCapacity(n),this.data.set(e.subarray(t,t+n),this.length),this.length+=n)}toTypedArray(){return this.data.slice(0,this.length)}ensureCapacity(e){if(this.length+e<=this.data.length)return;let t=this.data.length;for(;this.length+e>t;)t*=2;let n=new Float32Array(t);n.set(this.data),this.data=n}},Qa=1024,$a=2,eo=.08,to=24,no=.94;function ro(e){let t=Math.max(0,Math.trunc(e/$a+1e-6));return{alpha:Vo(e-t*$a),styleFlags:t}}async function io(e,t={},n,r=`copy`){return n?.throwIfAborted(),ka(t.iccEngine),vo(e),oo(e,t,ya(t.onProgress),0,n,r)}function ao(e,t,n,r,i){let a=t.child(n,r);return{...e,onProgress:e=>{a.report(e.value,{...e,executionPath:i})}}}async function oo(e,t,n,r,i,a=`copy`){let o=await so(e,ao(t,n,r,no,`worker`),i,a);return n.report(no,{stage:`compile`,executionPath:`worker`,sourceType:`pdf`,unit:`pages`,processed:o.length,total:o.length,pageCount:o.length}),o}async function so(e,t,n,r=`copy`){n?.throwIfAborted();let{openPdfInBrowserWorker:i,openPdfInNodeWorker:a}=await ze(async()=>{let{openPdfInBrowserWorker:e,openPdfInNodeWorker:t}=await import(`./workerClient-EkSIII0s.js`);return{openPdfInBrowserWorker:e,openPdfInNodeWorker:t}},[],import.meta.url);n?.throwIfAborted();let o=ya(t.onProgress);o.report(0,{stage:`source`,executionPath:`worker`,sourceType:`pdf`,unit:`bytes`,processed:0,total:e.byteLength});let s=-1,c=0,l=0,u=e=>{po(o,e,{selectionIndex:s,selectedPageCount:c,sourcePageCount:l})},d=null,f=!1;try{let f={kind:`bytes`,bytes:new Uint8Array(e),ownership:r},p=await lo(),m={repair:`safe`,password:t.password,imageCodecResolver:t.imageCodecResolver,signal:n,missingFontResolver:p,iccTransformResolver:t.iccTransformResolver,iccEngine:t.iccEngine,onDiagnostic:t.onDiagnostic,onProgress:u};d=uo()?await a(f,m):await i(f,m);let h=fo(d);l=h.info.pageCount;let g=zo(l,t.pages);c=g.length;let _=[];for(s=0;s<c;s+=1){n?.throwIfAborted();let e=g[s]-1,r=.12+s/c*.82,i=.12+(s+1)/c*.82;o.report(r,{stage:`pdf-page`,executionPath:`worker`,sourceType:`pdf`,unit:`pages`,processed:s,total:c,pageIndex:s,pageCount:c,sourcePageIndex:e,sourcePageCount:l});let a=await h.compileVectorPage(e,{signal:n,optimization:t.enableSegmentMerge===!1&&t.enableInvisibleCull===!1?`none`:`safe`,enableSegmentMerge:t.enableSegmentMerge!==!1,enableInvisibleCull:t.enableInvisibleCull!==!1,...t.annotationAppearances?{annotationAppearances:t.annotationAppearances}:{},onProgress:u});n?.throwIfAborted(),t.extractTextContent===!0&&(a.textContent=go(a,0)),_.push(a),o.report(i,{stage:`pdf-page`,executionPath:`worker`,sourceType:`pdf`,unit:`pages`,processed:s+1,total:c,pageIndex:s,pageCount:c,sourcePageIndex:e,sourcePageCount:l})}return n?.throwIfAborted(),o.report(1,{stage:`compile`,executionPath:`worker`,sourceType:`pdf`,unit:`pages`,processed:_.length,total:_.length,pageCount:_.length,sourcePageCount:l}),_}catch(e){throw f=!0,e}finally{try{await d?.close()}catch(e){if(!f)throw e}}}var co;function lo(){return co??=uo()?ze(async()=>{let{createNodeBundledStandardFontResolver:e}=await import(`./nodePdfSource-ZI1y_ULH.js`);return{createNodeBundledStandardFontResolver:e}},__vite__mapDeps([0,1]),import.meta.url).then(({createNodeBundledStandardFontResolver:e})=>e()):ze(async()=>{let{createBundledStandardFontResolver:e}=await import(`./standardFontResolver-BflqNAB5.js`);return{createBundledStandardFontResolver:e}},[],import.meta.url).then(({createBundledStandardFontResolver:e})=>e()),co}function uo(){return typeof globalThis.process?.versions?.node==`string`}function fo(e){if(typeof e.compileVectorPage!=`function`)throw TypeError(`The native PDF session does not expose VectorScene compilation.`);return e}function po(e,t,n){let r=mo(t.stage),i=n.selectionIndex>=0&&n.selectedPageCount>0,a=t.total&&t.total>0?Math.max(0,Math.min(1,t.completed/t.total)):0,o;o=i?.12+n.selectionIndex/n.selectedPageCount*.82+.82/n.selectedPageCount*(t.stage===`content`?.08+a*.56:t.stage===`optimize`?.66+a*.24:t.stage===`font`?.92:t.stage===`image`||t.stage===`color`?.96:.04):t.stage===`source-read`?.02*a:t.stage===`xref`?.05:t.stage===`catalog`?.09:.11,e.report(o,{stage:r,executionPath:`worker`,sourceType:`pdf`,unit:ho(t.stage),processed:t.completed,...t.total===null?{}:{total:t.total},...i?{pageIndex:n.selectionIndex,pageCount:n.selectedPageCount}:{},...t.sourcePageIndex===null?{}:{sourcePageIndex:t.sourcePageIndex},...n.sourcePageCount>0?{sourcePageCount:n.sourcePageCount}:{}})}function mo(e){switch(e){case`source-read`:case`xref`:case`catalog`:return`source`;case`page`:return`pdf-page`;case`content`:return`pdf-operators`;case`font`:return`pdf-text`;case`image`:case`color`:return`pdf-raster`;case`optimize`:return`pdf-optimize`;default:return`compile`}}function ho(e){if(e===`source-read`||e===`content`||e===`optimize`)return`bytes`;if(e===`page`)return`pages`}function go(e,t){let n=e.textIndex?.pages[t],r=[];if(!n||n.text.length===0)return r;let i=-1;for(let a=0;a<=n.charInstance.length;a+=1){if(a!==n.charInstance.length&&n.charInstance[a]!==-1){i<0&&(i=a);continue}if(i<0)continue;let o=n.text.slice(i,a).trim(),s=_o(e,n,i,a);o.length!==0&&s&&r.push({text:o,...s,pageIndex:t}),i=-1}return r}function _o(e,t,n,r){let i=1/0,a=1/0,o=-1/0,s=-1/0;for(let c=n;c<Math.min(r,t.charInstance.length);c+=1){let n=t.charInstance[c];if(n===-1)continue;if(n<=-2){let e=(-n-2)*4;e+3<t.fallbackQuads.length&&(i=Math.min(i,t.fallbackQuads[e]),a=Math.min(a,t.fallbackQuads[e+1]),o=Math.max(o,t.fallbackQuads[e+2]),s=Math.max(s,t.fallbackQuads[e+3]));continue}let r=n*4;if(r+3>=e.textInstanceA.length||r+3>=e.textInstanceB.length)continue;let l=Math.trunc(e.textInstanceB[r+2])*4;if(l<0||l+3>=e.textGlyphMetaA.length||l+1>=e.textGlyphMetaB.length)continue;let u=e.textInstanceA[r],d=e.textInstanceA[r+1],f=e.textInstanceA[r+2],p=e.textInstanceA[r+3],m=e.textInstanceB[r],h=e.textInstanceB[r+1],g=e.textGlyphMetaA[l+2],_=e.textGlyphMetaA[l+3],v=e.textGlyphMetaB[l],y=e.textGlyphMetaB[l+1],b=u*g+f*_+m,x=d*g+p*_+h,S=u*g+f*y+m,C=d*g+p*y+h,w=u*v+f*_+m,T=d*v+p*_+h,E=u*v+f*y+m,D=d*v+p*y+h,O=Math.min(b,S,w,E),k=Math.min(x,C,T,D),A=Math.max(b,S,w,E),j=Math.max(x,C,T,D),M=Math.trunc(e.textInstanceB[r+3]),N=(M-1)*4;M>0&&e.textClipRects&&N+3<e.textClipRects.length&&(O=Math.max(O,e.textClipRects[N]),k=Math.max(k,e.textClipRects[N+1]),A=Math.min(A,e.textClipRects[N+2]),j=Math.min(j,e.textClipRects[N+3])),O<=A&&k<=j&&(i=Math.min(i,O),a=Math.min(a,k),o=Math.max(o,A),s=Math.max(s,j))}return Number.isFinite(i)&&Number.isFinite(a)&&o>i&&s>a?{minX:i,minY:a,maxX:o,maxY:s}:null}function vo(e){Ja(new Uint8Array(e,0,Math.min(e.byteLength,Ka)))}function yo(e,t,n){return bo(e,t,n)}function bo(e,t,n){if(e.length===0)return _a();if(e.length===1)return{...e[0],pageCount:Math.max(1,e[0].pageRects.length/4),pagesPerRow:1,pageTextRanges:To(e[0])};let r=Ro(t,10,1,100),i=No(e,r),a=0,o=0,s=0,c=0,l=0,u=0,d=0,f=0,p=0,m=0,h=0,g=0,_=0,v=0,y=0,b=0,x=0,S=0,C=0,w=0,T=0,E=0,D=0,O=0,k=0,A=!1;for(let t of e){A||=t.textIndex!==null,a+=t.fillPathCount,o+=t.fillSegmentCount,s+=t.gradientCount,c+=t.gradientFillPathCount,l+=t.gradientFillSegmentCount,u+=t.gradientStrokeRunCount,d+=t.gradientStrokeSegmentCount,f+=t.segmentCount,p+=t.sourceSegmentCount,m+=t.mergedSegmentCount,h+=t.sourceTextCount,g+=t.textInstanceCount,_+=t.textGlyphCount,v+=t.textGlyphSegmentCount,y+=Math.floor((t.textClipRects?.length??0)/4),b+=t.textInPageCount,x+=t.textOutOfPageCount,S+=t.imagePaintOpCount,C+=t.pathCount,w+=t.discardedTransparentCount,T+=t.discardedDegenerateCount,E+=t.discardedDuplicateCount,D+=t.discardedContainedCount,O=Math.max(O,t.maxHalfWidth);let e=t.pageRects.length>=4?Math.floor(t.pageRects.length/4):1;k+=Math.max(1,e)}let j=new Float32Array(a*4),M=new Float32Array(a*4),N=new Float32Array(a*4),P=new Float32Array(o*4),F=new Float32Array(o*4),I=new Float32Array(s*4),L=new Float32Array(s*4),R=new Float32Array(s*4),z=new Float32Array(s*4),ee=new Float32Array(s*4),te=new Uint8Array(s*Qa*4),ne=e.some(e=>(e.gradientMeshIndices?.length??0)>0),re=ne?new Uint32Array(s*2):void 0,ie=ne?new Float32Array(e.reduce((e,t)=>e+(t.gradientMeshPositions?.length??0),0)):void 0,ae=ne?new Float32Array(e.reduce((e,t)=>e+(t.gradientMeshColors?.length??0),0)):void 0,oe=ne?new Uint32Array(e.reduce((e,t)=>e+(t.gradientMeshIndices?.length??0),0)):void 0,se=0,ce=0,le=new Float32Array(c*4),ue=new Float32Array(c*4),de=new Float32Array(c*4),fe=new Float32Array(c*4),pe=new Float32Array(l*4),me=new Float32Array(l*4),he=new Float32Array(u*4),ge=new Float32Array(u*4),_e=new Float32Array(d*4),ve=new Float32Array(d*4),ye=new Float32Array(d*4),be=new Float32Array(d*4),xe=new Float32Array(f*4),Se=new Float32Array(f*4),Ce=new Float32Array(f*4),we=new Float32Array(f*4),Te=new Float32Array(g*4),Ee=new Float32Array(g*4),De=new Float32Array(g*4),Oe=new Float32Array(y*4),ke=new Float32Array(_*4),Ae=new Float32Array(_*4),je=new Float32Array(v*4),Me=new Float32Array(v*4),Ne=new Float32Array(k*4),Pe=new Uint32Array(k*2),Fe=0,Ie=0,Le=0,Re=0,ze=0,Be=0,Ve=0,He=0,Ue=0,We=0,Ge=0,Ke=0,qe=0,Je=null,Ye=null,Xe=Wa(e.map(e=>e.optionalContent));Xe.droppedAnnotationLayers&&n?.({code:`annotation.layer-limit`,severity:`warning`,message:`${Xe.droppedAnnotationLayers} annotation appearance(s) exceed the scene's layer limit and cannot be hidden individually.`,details:{annotationCount:Xe.droppedAnnotationLayers}});let Ze=e.some(e=>e.paintGraph)?{roots:[]}:void 0,Qe=[],$e=[],et=Ze||e.some(e=>e.drawRuns)?[]:void 0,tt=e.every(e=>e.pageRects.length<=4||e.pagePrimitiveRanges)?new Uint32Array(k*da):void 0,nt=[],rt=[],it=[],at=[],ot=[],st=[],ct=!1;for(let t=0;t<e.length;t+=1){let n=e[t],r=i[t];$i(n);let a=r.translateX,o=r.translateY,s=qe;if(st.push({scene:n,offsets:{pageRectBase:s,primitives:{fill:Fe,stroke:He,text:Ue,raster:nt.length,"gradient-fill":Re,"gradient-stroke":Be}}}),tt){pa(n);let e=[He,Fe,Ue,nt.length,Re,Be],t=fa({...n,rasterLayers:Lo(n)}),r=Math.max(1,n.pageRects.length/4);for(let i=0;i<r;i++)ua.forEach((r,a)=>{let o=i*da+a*2,c=(s+i)*da+a*2;tt[c]=e[a]+(n.pagePrimitiveRanges?.[o]??0),tt[c+1]=n.pagePrimitiveRanges?.[o+1]??t[r]})}for(let e of n.pdfPages??[]){let[t,n,r,i,c,l]=e.pdfToScene;ot.push({...e,pageIndex:s+e.pageIndex,pdfToScene:[t,n,r,i,c+a,l+o]})}for(let e of n.annotations??[])at.push(ht(e,s+e.pageIndex,a,o,Xe.offsets[t]));let c=$e.length,l=Qe.length;for(let e of n.retainedPages??[]){let n=e.matrix.slice();n[4]+=a,n[5]+=o,Qe.push({page:e.page,matrix:n,optionalContentConditions:e.optionalContentConditions.map(e=>e<0?e:e+Xe.offsets[t])})}for(let e of n.clipPaths??[]){let t=e.edges.slice();for(let e=0;e<t.length;e+=2)t[e]+=a,t[e+1]+=o;$e.push({parent:e.parent<0?-1:e.parent+c,fillRule:e.fillRule,edges:t})}if(et){Nn(n);let e=et.length,r={fill:Fe,stroke:He,text:Ue,raster:nt.length,"gradient-fill":Re,"gradient-stroke":Be};for(let e of n.drawRuns??Mn({...n,rasterLayers:Lo(n)})){let n=e.clipIndex===void 0?void 0:e.clipIndex+c,i=e.optionalContent===void 0?void 0:e.optionalContent+Xe.offsets[t];Ze?et.push({...e,first:e.first+r[e.kind],...n===void 0?{}:{clipIndex:n},...i===void 0?{}:{optionalContent:i}}):An(et,e.kind,e.first+r[e.kind],e.count,n,e.blendMode,i)}if(Ze){if(n.paintGraph)Ze.roots.push(...Ua(n.paintGraph,{run:e,raster:nt.length,retainedPage:l,condition:Xe.offsets[t],x:a,y:o}).roots);else for(let t=e;t<et.length;t++)Ze.roots.push({kind:`draw`,runIndex:t})}}if(n.textContent){ct=!0;for(let e of n.textContent)it.push({text:e.text,minX:e.minX+a,minY:e.minY+o,maxX:e.maxX+a,maxY:e.maxY+o,pageIndex:s+e.pageIndex})}for(let e=0;e<n.fillPathCount;e+=1){let t=e*4,r=(Fe+e)*4;j[r]=n.fillPathMetaA[t]+Ie,j[r+1]=n.fillPathMetaA[t+1],j[r+2]=n.fillPathMetaA[t+2]+a,j[r+3]=n.fillPathMetaA[t+3]+o,M[r]=n.fillPathMetaB[t]+a,M[r+1]=n.fillPathMetaB[t+1]+o,M[r+2]=n.fillPathMetaB[t+2],M[r+3]=n.fillPathMetaB[t+3],N[r]=n.fillPathMetaC[t],N[r+1]=n.fillPathMetaC[t+1],N[r+2]=n.fillPathMetaC[t+2],N[r+3]=n.fillPathMetaC[t+3]}for(let e=0;e<n.fillSegmentCount;e+=1){let t=e*4,r=(Ie+e)*4;P[r]=n.fillSegmentsA[t]+a,P[r+1]=n.fillSegmentsA[t+1]+o,P[r+2]=n.fillSegmentsA[t+2]+a,P[r+3]=n.fillSegmentsA[t+3]+o,F[r]=n.fillSegmentsB[t]+a,F[r+1]=n.fillSegmentsB[t+1]+o,F[r+2]=n.fillSegmentsB[t+2],F[r+3]=n.fillSegmentsB[t+3]}if(re&&ie&&ae&&oe&&n.gradientMeshIndices){ie.set(n.gradientMeshPositions,se*2),ae.set(n.gradientMeshColors,se*4);for(let e=0;e<n.gradientMeshIndices.length;e++)oe[ce+e]=n.gradientMeshIndices[e]+se;for(let e=0;e<n.gradientCount;e++)re[(Le+e)*2]=n.gradientMeshRanges[e*2]+ce,re[(Le+e)*2+1]=n.gradientMeshRanges[e*2+1];se+=n.gradientMeshPositions.length/2,ce+=n.gradientMeshIndices.length}for(let e=0;e<n.gradientCount;e+=1){let t=e*4,r=(Le+e)*4;I.set(n.gradientMetaA.subarray(t,t+4),r),L.set(n.gradientMetaB.subarray(t,t+4),r),R[r]=n.gradientMetaC[t]-n.gradientMetaB[t]*a-n.gradientMetaB[t+2]*o,R[r+1]=n.gradientMetaC[t+1]-n.gradientMetaB[t+1]*a-n.gradientMetaB[t+3]*o,R[r+2]=n.gradientMetaC[t+2],R[r+3]=n.gradientMetaC[t+3],z.set(n.gradientMetaD.subarray(t,t+4),r),ee.set(n.gradientMetaE.subarray(t,t+4),r);let i=e*Qa*4,s=(Le+e)*Qa*4;te.set(n.gradientLut.subarray(i,i+Qa*4),s)}for(let e=0;e<n.gradientFillPathCount;e+=1){let t=e*4,r=(Re+e)*4;le[r]=n.gradientFillPathMetaA[t]+ze,le[r+1]=n.gradientFillPathMetaA[t+1],le[r+2]=n.gradientFillPathMetaA[t+2]+a,le[r+3]=n.gradientFillPathMetaA[t+3]+o,ue[r]=n.gradientFillPathMetaB[t]+a,ue[r+1]=n.gradientFillPathMetaB[t+1]+o,ue[r+2]=n.gradientFillPathMetaB[t+2],ue[r+3]=n.gradientFillPathMetaB[t+3],de.set(n.gradientFillPathMetaC.subarray(t,t+4),r);let i=n.gradientFillPaintMeta[t],c=n.gradientFillPaintMeta[t+1];fe[r]=i>=0?i+Le:-1,fe[r+1]=c>=0?c+Le:-1,fe[r+2]=n.gradientFillPaintMeta[t+2],fe[r+3]=s+n.gradientFillPaintMeta[t+3]}for(let e=0;e<n.gradientFillSegmentCount;e+=1){let t=e*4,r=(ze+e)*4;pe[r]=n.gradientFillSegmentsA[t]+a,pe[r+1]=n.gradientFillSegmentsA[t+1]+o,pe[r+2]=n.gradientFillSegmentsA[t+2]+a,pe[r+3]=n.gradientFillSegmentsA[t+3]+o,me[r]=n.gradientFillSegmentsB[t]+a,me[r+1]=n.gradientFillSegmentsB[t+1]+o,me[r+2]=n.gradientFillSegmentsB[t+2],me[r+3]=n.gradientFillSegmentsB[t+3]}for(let e=0;e<n.gradientStrokeRunCount;e+=1){let t=e*4,r=(Be+e)*4;he[r]=n.gradientStrokeRunMetaA[t]+Ve,he[r+1]=n.gradientStrokeRunMetaA[t+1];let i=n.gradientStrokeRunMetaA[t+2],a=n.gradientStrokeRunMetaA[t+3];he[r+2]=i>=0?i+Le:-1,he[r+3]=a>=0?a+Le:-1,ge[r]=n.gradientStrokeRunMetaB[t],ge[r+1]=s+n.gradientStrokeRunMetaB[t+1],ge[r+2]=0,ge[r+3]=0}for(let e=0;e<n.gradientStrokeSegmentCount;e+=1){let t=e*4,r=(Ve+e)*4;_e[r]=n.gradientStrokeEndpoints[t]+a,_e[r+1]=n.gradientStrokeEndpoints[t+1]+o,_e[r+2]=n.gradientStrokeEndpoints[t+2]+a,_e[r+3]=n.gradientStrokeEndpoints[t+3]+o,ve[r]=n.gradientStrokePrimitiveMeta[t]+a,ve[r+1]=n.gradientStrokePrimitiveMeta[t+1]+o,ve[r+2]=n.gradientStrokePrimitiveMeta[t+2],ve[r+3]=n.gradientStrokePrimitiveMeta[t+3],ye[r]=n.gradientStrokePrimitiveBounds[t]+a,ye[r+1]=n.gradientStrokePrimitiveBounds[t+1]+o,ye[r+2]=n.gradientStrokePrimitiveBounds[t+2]+a,ye[r+3]=n.gradientStrokePrimitiveBounds[t+3]+o,be.set(n.gradientStrokeStyles.subarray(t,t+4),r)}for(let e=0;e<n.segmentCount;e+=1){let t=e*4,r=(He+e)*4;xe[r]=n.endpoints[t]+a,xe[r+1]=n.endpoints[t+1]+o,xe[r+2]=n.endpoints[t+2]+a,xe[r+3]=n.endpoints[t+3]+o,Se[r]=n.primitiveMeta[t]+a,Se[r+1]=n.primitiveMeta[t+1]+o,Se[r+2]=n.primitiveMeta[t+2],Se[r+3]=n.primitiveMeta[t+3],Ce[r]=n.primitiveBounds[t]+a,Ce[r+1]=n.primitiveBounds[t+1]+o,Ce[r+2]=n.primitiveBounds[t+2]+a,Ce[r+3]=n.primitiveBounds[t+3]+o,we[r]=n.styles[t],we[r+1]=n.styles[t+1],we[r+2]=n.styles[t+2],we[r+3]=n.styles[t+3]}Te.set(n.textInstanceA,Ue*4),De.set(n.textInstanceC,Ue*4);for(let e=0;e<n.textInstanceCount;e+=1){let t=e*4,r=(Ue+e)*4;Ee[r]=n.textInstanceB[t]+a,Ee[r+1]=n.textInstanceB[t+1]+o,Ee[r+2]=n.textInstanceB[t+2]+We;let i=n.textInstanceB[t+3];Ee[r+3]=i>0?i+Ke:0}let u=n.textClipRects;if(u){for(let e=0;e<u.length;e+=4){let t=Ke*4+e;Oe[t]=u[e]+a,Oe[t+1]=u[e+1]+o,Oe[t+2]=u[e+2]+a,Oe[t+3]=u[e+3]+o}Ke+=u.length/4}for(let e=0;e<n.textGlyphCount;e+=1){let t=e*4,r=(We+e)*4;ke[r]=n.textGlyphMetaA[t]+Ge,ke[r+1]=n.textGlyphMetaA[t+1],ke[r+2]=n.textGlyphMetaA[t+2],ke[r+3]=n.textGlyphMetaA[t+3],Ae[r]=n.textGlyphMetaB[t],Ae[r+1]=n.textGlyphMetaB[t+1],Ae[r+2]=n.textGlyphMetaB[t+2],Ae[r+3]=n.textGlyphMetaB[t+3]}je.set(n.textGlyphSegmentsA,Ge*4),Me.set(n.textGlyphSegmentsB,Ge*4);let d=n.pageRects;if(d.length>=4){let e=Math.floor(d.length/4),r=To(n,e);for(let t=0;t<e;t+=1){let e=t*4,n=(qe+t)*4;Ne[n]=d[e]+a,Ne[n+1]=d[e+1]+o,Ne[n+2]=d[e+2]+a,Ne[n+3]=d[e+3]+o;let i=(qe+t)*2,s=t*2;Pe[i]=r[s]+Ue,Pe[i+1]=r[s+1]}xo(rt,n,e,a,o,Ue,Xe.offsets[t]),qe+=e}else{let e=qe*4;Ne[e]=n.pageBounds.minX+a,Ne[e+1]=n.pageBounds.minY+o,Ne[e+2]=n.pageBounds.maxX+a,Ne[e+3]=n.pageBounds.maxY+o;let r=qe*2;Pe[r]=Ue,Pe[r+1]=n.textInstanceCount,xo(rt,n,1,a,o,Ue,Xe.offsets[t]),qe+=1}Je=Bo(Je,Io(n.bounds,a,o)),Ye=Bo(Ye,Io(n.pageBounds,a,o));for(let e of Lo(n)){if(e.matrix.length<6)continue;let t=new Float32Array(6);t[0]=e.matrix[0],t[1]=e.matrix[1],t[2]=e.matrix[2],t[3]=e.matrix[3],t[4]=e.matrix[4]+a,t[5]=e.matrix[5]+o,nt.push({width:e.width,height:e.height,data:e.data,matrix:t,...e.opacity===void 0?{}:{opacity:e.opacity},paintOrder:e.paintOrder,pageIndex:s+e.pageIndex})}Fe+=n.fillPathCount,Ie+=n.fillSegmentCount,Le+=n.gradientCount,Re+=n.gradientFillPathCount,ze+=n.gradientFillSegmentCount,Be+=n.gradientStrokeRunCount,Ve+=n.gradientStrokeSegmentCount,He+=n.segmentCount,Ue+=n.textInstanceCount,We+=n.textGlyphCount,Ge+=n.textGlyphSegmentCount}let lt=nt[0]??null,{droppedPages:ut,...dt}=Gn(st);ut&&n?.({code:`structure.limit`,severity:`warning`,message:`${ut} page(s) exceed the scene's structure attribution limit; their content has no MCIDs.`,details:{pageCount:ut}});let ft={annotations:at,...e[0].annotationAppearances?{annotationAppearances:e[0].annotationAppearances}:{},...dt,pdfPages:ot,...Ze?{paintGraph:Ze}:{},...Qe.length?{retainedPages:Qe}:{},...Xe.data?{optionalContent:Xe.data}:{},...$e.length?{clipPaths:$e}:{},...et?{drawRuns:et}:{},pageCount:k,pagesPerRow:r,pageRects:Ne,pageTextRanges:Pe,...tt?{pagePrimitiveRanges:tt}:{},textIndex:A?{version:2,pages:rt}:null,fillPathCount:a,fillSegmentCount:o,fillPathMetaA:j,fillPathMetaB:M,fillPathMetaC:N,fillSegmentsA:P,fillSegmentsB:F,gradientCount:s,gradientMetaA:I,gradientMetaB:L,gradientMetaC:R,gradientMetaD:z,gradientMetaE:ee,gradientLut:te,...ne?{gradientMeshRanges:re,gradientMeshPositions:ie,gradientMeshColors:ae,gradientMeshIndices:oe}:{},gradientFillPathCount:c,gradientFillSegmentCount:l,gradientFillPathMetaA:le,gradientFillPathMetaB:ue,gradientFillPathMetaC:de,gradientFillPaintMeta:fe,gradientFillSegmentsA:pe,gradientFillSegmentsB:me,gradientStrokeRunCount:u,gradientStrokeSegmentCount:d,gradientStrokeRunMetaA:he,gradientStrokeRunMetaB:ge,gradientStrokeEndpoints:_e,gradientStrokePrimitiveMeta:ve,gradientStrokePrimitiveBounds:ye,gradientStrokeStyles:be,segmentCount:f,sourceSegmentCount:p,mergedSegmentCount:m,...e.every(e=>e.imageLayerSegmentCount!==void 0)?{imageLayerSegmentCount:e.reduce((e,t)=>e+t.imageLayerSegmentCount,0)}:{},sourceTextCount:h,textInstanceCount:g,textGlyphCount:_,textGlyphSegmentCount:v,textInPageCount:b,textOutOfPageCount:x,textInstanceA:Te,textInstanceB:Ee,textInstanceC:De,...Oe.length===0?{}:{textClipRects:Oe},textGlyphMetaA:ke,textGlyphMetaB:Ae,textGlyphSegmentsA:je,textGlyphSegmentsB:Me,rasterLayers:nt,rasterLayerWidth:lt?.width??0,rasterLayerHeight:lt?.height??0,rasterLayerData:lt?.data??new Uint8Array,rasterLayerMatrix:lt?.matrix??new Float32Array([1,0,0,1,0,0]),endpoints:xe,primitiveMeta:Se,primitiveBounds:Ce,styles:we,bounds:Je??{minX:0,minY:0,maxX:1,maxY:1},pageBounds:Ye??Je??{minX:0,minY:0,maxX:1,maxY:1},maxHalfWidth:O,imagePaintOpCount:S,pathCount:C,discardedTransparentCount:w,discardedDegenerateCount:T,discardedDuplicateCount:E,discardedContainedCount:D};return ct&&(ft.textContent=it),Co(ft)}function xo(e,t,n,r,i,a,o=0){let s=t.textIndex?.pages??[];for(let t=0;t<n;t+=1){let n=s[t];n&&n.text.length>0?e.push(So(n,r,i,a,o)):e.push({text:``,charInstance:new Int32Array,fallbackQuads:new Float32Array})}}function So(e,t,n,r,i=0){let a=new Int32Array(e.charInstance.length);for(let t=0;t<a.length;t+=1){let n=e.charInstance[t];a[t]=n>=0?n+r:n}let o=e.fallbackQuads,s=new Float32Array(o.length);for(let e=0;e+3<o.length;e+=4)s[e]=o[e]+t,s[e+1]=o[e+1]+n,s[e+2]=o[e+2]+t,s[e+3]=o[e+3]+n;return{text:e.text,charInstance:a,fallbackQuads:s,...e.optionalContent?{optionalContent:Int32Array.from(e.optionalContent,e=>e<0?-1:e+i)}:{}}}function Co(e){let t=Math.max(0,e.textGlyphCount|0),n=Math.max(0,e.textGlyphSegmentCount|0);if(t<=1||n<=0||e.textGlyphMetaA.length<t*4||e.textGlyphMetaB.length<t*4)return e;let r=new Uint32Array(e.textGlyphSegmentsA.buffer,e.textGlyphSegmentsA.byteOffset,e.textGlyphSegmentsA.length),i=new Uint32Array(e.textGlyphSegmentsB.buffer,e.textGlyphSegmentsB.byteOffset,e.textGlyphSegmentsB.length),a=new Uint32Array(e.textGlyphMetaA.buffer,e.textGlyphMetaA.byteOffset,e.textGlyphMetaA.length),o=new Uint32Array(e.textGlyphMetaB.buffer,e.textGlyphMetaB.byteOffset,e.textGlyphMetaB.length),s=new Uint32Array(t),c=[],l=new Map,u=new Za(Math.min(t,4096)),d=new Za(Math.min(t,4096)),f=new Za(Math.min(n,65536)),p=new Za(Math.min(n,65536));for(let n=0;n<t;n+=1){let t=Eo(e,n,a,o,r,i),m=l.get(t),h=-1;if(m){for(let t of m)if(Do(e,n,c[t])){h=t;break}}if(h<0){h=c.length,c.push(n),m?m.push(h):l.set(t,[h]);let r=n*4,i=Math.max(0,Math.trunc(e.textGlyphMetaA[r])),a=Math.max(0,Math.trunc(e.textGlyphMetaA[r+1])),o=i*4,s=Math.min(a*4,Math.max(0,e.textGlyphSegmentsA.length-o),Math.max(0,e.textGlyphSegmentsB.length-o)),g=f.quadCount;f.append(e.textGlyphSegmentsA,o,s),p.append(e.textGlyphSegmentsB,o,s),u.push(g,s/4,e.textGlyphMetaA[r+2],e.textGlyphMetaA[r+3]),d.push(e.textGlyphMetaB[r],e.textGlyphMetaB[r+1],e.textGlyphMetaB[r+2],e.textGlyphMetaB[r+3])}s[n]=h}if(c.length===t)return e;let m=e.textInstanceB;for(let t=0;t<e.textInstanceCount;t+=1){let e=t*4+2,n=Math.max(0,Math.trunc(m[e]));n<s.length&&(m[e]=s[n])}return{...e,textInstanceB:m,textGlyphCount:c.length,textGlyphSegmentCount:f.quadCount,textGlyphMetaA:u.toTypedArray(),textGlyphMetaB:d.toTypedArray(),textGlyphSegmentsA:f.toTypedArray(),textGlyphSegmentsB:p.toTypedArray()}}function wo(e,t,n){let r=Math.max(1,Math.floor(e.length/4)),i=new Uint32Array(r*2),a=Math.max(0,Math.min(n|0,Math.floor(t.length/4)));if(r<=1||a<=0)return i[0]=0,i[1]=a,i;let o=ko(e,r),s=0,c=0;for(let n=0;n<a;n+=1){let a=n*4,l=t[a],u=t[a+1];if(!Number.isFinite(l)||!Number.isFinite(u)||jo(e,s,l,u,o))continue;let d=Ao(e,r,s+1,l,u,o);if(!(d<=s)){i[s*2]=c,i[s*2+1]=n-c;for(let e=s+1;e<d;e+=1)i[e*2]=n,i[e*2+1]=0;s=d,c=n}}i[s*2]=c,i[s*2+1]=a-c;for(let e=s+1;e<r;e+=1)i[e*2]=a,i[e*2+1]=0;return i}function To(e,t){let n=Math.floor(e.pageRects.length/4)||e.pageCount||1,r=Math.max(1,t??n)*2;return e.pageTextRanges instanceof Uint32Array&&e.pageTextRanges.length>=r?e.pageTextRanges.subarray(0,r):wo(e.pageRects,e.textInstanceB,e.textInstanceCount)}function Eo(e,t,n,r,i,a){let o=t*4,s=Math.max(0,Math.trunc(e.textGlyphMetaA[o])),c=Math.max(0,Math.trunc(e.textGlyphMetaA[o+1])),l=s*4,u=Math.min(c*4,Math.max(0,i.length-l),Math.max(0,a.length-l)),d=2166136261;d=Oo(d,c),d=Oo(d,n[o+2]??0),d=Oo(d,n[o+3]??0),d=Oo(d,r[o]??0),d=Oo(d,r[o+1]??0);for(let e=0;e<u;e+=1)d=Oo(d,i[l+e]),d=Oo(d,a[l+e]);return`${c}:${d>>>0}`}function Do(e,t,n){if(t===n)return!0;let r=t*4,i=n*4,a=Math.max(0,Math.trunc(e.textGlyphMetaA[r+1]));if(a!==Math.max(0,Math.trunc(e.textGlyphMetaA[i+1]))||e.textGlyphMetaA[r+2]!==e.textGlyphMetaA[i+2]||e.textGlyphMetaA[r+3]!==e.textGlyphMetaA[i+3]||e.textGlyphMetaB[r]!==e.textGlyphMetaB[i]||e.textGlyphMetaB[r+1]!==e.textGlyphMetaB[i+1]||e.textGlyphMetaB[r+2]!==e.textGlyphMetaB[i+2]||e.textGlyphMetaB[r+3]!==e.textGlyphMetaB[i+3])return!1;let o=Math.max(0,Math.trunc(e.textGlyphMetaA[r])),s=Math.max(0,Math.trunc(e.textGlyphMetaA[i])),c=o*4,l=s*4,u=a*4;for(let t=0;t<u;t+=1)if(e.textGlyphSegmentsA[c+t]!==e.textGlyphSegmentsA[l+t]||e.textGlyphSegmentsB[c+t]!==e.textGlyphSegmentsB[l+t])return!1;return!0}function Oo(e,t){return e^=t>>>0,Math.imul(e,16777619)}function ko(e,t){let n=0,r=0;for(let i=0;i<t;i+=1){let t=i*4,a=Math.abs(e[t+2]-e[t]),o=Math.abs(e[t+3]-e[t+1]),s=Math.max(a,o);Number.isFinite(s)&&s>0&&(n+=s,r+=1)}return r===0?8:Mo(n/r*.025,4,24)}function Ao(e,t,n,r,i,a){for(let o=Math.max(0,n);o<t;o+=1)if(jo(e,o,r,i,a))return o;return-1}function jo(e,t,n,r,i){let a=t*4,o=Math.min(e[a],e[a+2])-i,s=Math.max(e[a],e[a+2])+i,c=Math.min(e[a+1],e[a+3])-i,l=Math.max(e[a+1],e[a+3])+i;return n>=o&&n<=s&&r>=c&&r<=l}function Mo(e,t,n){return e<t?t:e>n?n:e}function No(e,t){let n=e.map(e=>Po(e.pageBounds,e.bounds)),r=Math.ceil(e.length/t),i=new Float64Array(r),a=0;for(let e=0;e<n.length;e+=1){let r=n[e],o=Math.max(r.maxX-r.minX,.001),s=Math.max(r.maxY-r.minY,.001);a+=Math.max(o,s);let c=Math.floor(e/t);i[c]=Math.max(i[c],s)}let o=a/Math.max(1,n.length),s=Math.max(o*eo,to),c=new Float64Array(r);for(let e=1;e<r;e+=1)c[e]=c[e-1]-i[e-1]-s;let l=new Float64Array(r),u=Array(e.length);for(let e=0;e<n.length;e+=1){let r=n[e],i=Math.max(r.maxX-r.minX,.001),a=Math.floor(e/t),o=l[a]-r.minX,d=c[a]-r.maxY;u[e]={translateX:o,translateY:d},l[a]+=i+s}return u}function Po(e,t){let n=Fo(e)?e:t;return Fo(n)?n:{minX:0,minY:0,maxX:1,maxY:1}}function Fo(e){return Number.isFinite(e.minX)&&Number.isFinite(e.minY)&&Number.isFinite(e.maxX)&&Number.isFinite(e.maxY)}function Io(e,t,n){return{minX:e.minX+t,minY:e.minY+n,maxX:e.maxX+t,maxY:e.maxY+n}}function Lo(e){let t=[];if(Array.isArray(e.rasterLayers))for(let n of e.rasterLayers){let e=Math.max(0,Math.trunc(n?.width??0)),r=Math.max(0,Math.trunc(n?.height??0));if(e<=0||r<=0||!(n.data instanceof Uint8Array)||n.data.length<e*r*4)continue;let i=new Float32Array(6);n.matrix.length>=6?(i[0]=n.matrix[0],i[1]=n.matrix[1],i[2]=n.matrix[2],i[3]=n.matrix[3],i[4]=n.matrix[4],i[5]=n.matrix[5]):(i[0]=1,i[3]=1),t.push({width:e,height:r,data:n.data,matrix:i,...n.opacity===void 0?{}:{opacity:n.opacity},paintOrder:Number.isFinite(n.paintOrder)?n.paintOrder:0,pageIndex:Number.isFinite(n.pageIndex)?Math.max(0,Math.trunc(n.pageIndex)):0})}if(t.length>0)return t;let n=Math.max(0,Math.trunc(e.rasterLayerWidth)),r=Math.max(0,Math.trunc(e.rasterLayerHeight));if(n<=0||r<=0||e.rasterLayerData.length<n*r*4)return t;let i=new Float32Array([1,0,0,1,0,0]);return e.rasterLayerMatrix.length>=6&&(i[0]=e.rasterLayerMatrix[0],i[1]=e.rasterLayerMatrix[1],i[2]=e.rasterLayerMatrix[2],i[3]=e.rasterLayerMatrix[3],i[4]=e.rasterLayerMatrix[4],i[5]=e.rasterLayerMatrix[5]),t.push({width:n,height:r,data:e.rasterLayerData,matrix:i,paintOrder:0,pageIndex:0}),t}function Ro(e,t,n,r){let i=Math.trunc(Number(e)),a=Number.isFinite(i)?i:t;return a<n?n:a>r?r:a}function zo(e,t){if(t!==void 0&&typeof t!=`string`)throw TypeError(`pages must be a string.`);let n=t?.trim()??``;if(n.length===0)return Array.from({length:e},(e,t)=>t+1);let r=new Set;for(let i of n.split(`,`)){let n=i.trim(),a=/^(\d+)$/.exec(n),o=/^(\d*)\s*-\s*(\d*)$/.exec(n);if(!a&&!o)throw RangeError(`Invalid pages value "${t}". Use comma-separated page numbers or inclusive ranges such as "1-5, 8, 11-13".`);let s=a?Number(a[1]):o?.[1]?Number(o[1]):1,c=a?s:o?.[2]?Number(o[2]):e;if(!Number.isSafeInteger(s)||!Number.isSafeInteger(c))throw RangeError(`Invalid page range "${n}": page numbers must be safe integers.`);if(s<1||s>e||c<1||c>e)throw RangeError(`PDF page number ${s<1||s>e?s:c} is out of range; the document contains ${e} page${e===1?``:`s`}.`);if(s>c)throw RangeError(`Invalid page range "${n}": the first page must not exceed the last page.`);for(let e=s;e<=c;e+=1)r.add(e)}return Array.from(r).sort((e,t)=>e-t)}function Bo(e,t){if(!e&&!t)return null;if(!e&&t)return{...t};if(e&&!t)return{...e};let n=e,r=t;return{minX:Math.min(n.minX,r.minX),minY:Math.min(n.minY,r.minY),maxX:Math.max(n.maxX,r.maxX),maxY:Math.max(n.maxY,r.maxY)}}function Vo(e){return e<=0?0:e>=1?1:e}var Ho=4294967295,Uo=8192,Wo=16777216,Go=1073741824,Ko=2*Go,qo=65536,Jo=new TextEncoder,Yo=new TextDecoder(`utf-8`,{fatal:!0,ignoreBOM:!0}),Xo=new Uint32Array(256);for(let e=0;e<Xo.length;e+=1){let t=e;for(let e=0;e<8;e+=1)t=t>>>1^(t&1?3988292384:0);Xo[e]=t>>>0}function Zo(e){let t=4294967295;for(let n=0;n<e.length;n+=1)t=Xo[(t^e[n])&255]^t>>>8;return(t^4294967295)>>>0}function Qo(e){return e instanceof Uint8Array?e:new Uint8Array(e)}function $o(e){let t=Qo(e);return t.length>=4&&t[0]===72&&t[1]===69&&t[2]===80&&t[3]===0}function es(e){let t=Qo(e);return t.length>=4&&t[0]===80&&t[1]===75&&(t[2]===3&&t[3]===4||t[2]===5&&t[3]===6||t[2]===7&&t[3]===8)}function ts(e){return Math.ceil(e/4)*4}function ns(e){throw Error(`Invalid HEP container: ${e}`)}function rs(e,t,n,r){for(let i=t;i<n;i+=1)e[i]!==0&&ns(`nonzero ${r}.`)}function is(e){(!e||e.includes(`\0`)||e.includes(`\\`)||e.split(`/`).some(e=>!e||e===`.`||e===`..`))&&ns(`invalid section name ${JSON.stringify(e)}.`);let t=Jo.encode(e);return(t.length>65535||Yo.decode(t)!==e)&&ns(`invalid UTF-8 section name.`),t}function as(e,t){let n=Go;if(e===`manifest.json`&&(n=16777216),(e===`lod-vector/index.json`||e===`lod-text/index.json`)&&(n=67108864),e===`annotations/annotations.json`&&(n=67108864),(e===`source/source.pdf`||e===`source.pdf`)&&(n=536870912),e.startsWith(`raster/`)&&(n=805306368),t&&Object.hasOwn(t,e)){let r=t[e];(!Number.isSafeInteger(r)||r<0)&&ns(`invalid byte limit for ${e}.`),n=Math.min(n,r)}return n}function os(e,t,n){(!Number.isSafeInteger(t)||t<0||t>as(e,n))&&ns(`section ${e} exceeds its decoded byte limit.`)}async function ss(e,t,n,r){r?.throwIfAborted();let i=t?globalThis.CompressionStream:globalThis.DecompressionStream;if(typeof i!=`function`)throw Error(`HEP ${t?`compression`:`decompression`} requires native ${t?`CompressionStream`:`DecompressionStream`}("deflate"). Use a current Node.js release or modern browser`+(t?`, or export with compression: "store".`:`.`));let a=new i(`deflate`),o=a.readable.getReader(),s=a.writable.getWriter(),c,l=!1,u=e=>{l||(l=!0,c=e),o.cancel(e).catch(()=>{}),s.abort(e).catch(()=>{})},d=()=>u(r?.reason);r?.addEventListener(`abort`,d,{once:!0});let f=(async()=>{try{for(let t=0;t<e.length;t+=qo){r?.throwIfAborted();let n=e.subarray(t,t+qo);await s.write(n.buffer instanceof ArrayBuffer?n:new Uint8Array(n))}await s.close()}catch(e){u(e)}})();try{let e=[],t=0;for(;;){r?.throwIfAborted();let i=await o.read();if(i.done)break;t+=i.value.length,t>n&&ns(`decompressed output exceeds the declared chunk length or byte limit.`),e.push(i.value)}if(await f,r?.throwIfAborted(),l)throw c;let i=new Uint8Array(t),a=0;for(let t of e)i.set(t,a),a+=t.length;return i}catch(e){throw u(e),await f,r?.aborted?r.reason:e}finally{r?.removeEventListener(`abort`,d),o.releaseLock(),s.releaseLock()}}var cs=4096;function ls(e){let t=e.indexOf(`/`);if(!(e===`manifest.json`||e===`source.pdf`||t<0||e.startsWith(`raster/`)||e.startsWith(`source/`)||/\.pdf$/i.test(e)))return e.slice(0,t)}function us(e){return/\.(webp|png)$/i.test(e)}var ds=4,fs=4,ps=fs*Float32Array.BYTES_PER_ELEMENT,ms=256;function hs(e){let t=e.length/fs;if(t===0||e.byteLength>1073741824)return null;let n=new Uint32Array(ms*fs),r=new Uint8Array(t),i=new Map,a=NaN,o=NaN,s=NaN,c=NaN,l=0;for(let u=0;u<t;u++){let t=u*fs,d=e[t],f=e[t+1],p=e[t+2],m=e[t+3];if(d!==a||f!==o||p!==s||m!==c){let e=`${d},${f},${p},${m}`,t=i.get(e);if(t===void 0){if(t=i.size,t===ms)return null;i.set(e,t);let r=t*fs;n[r]=d,n[r+1]=f,n[r+2]=p,n[r+3]=m}a=d,o=f,s=p,c=m,l=t}r[u]=l}let u=i.size*ps,d=ds+u+t;if(d>=e.byteLength)return null;let f=new Uint8Array(d),p=new DataView(f.buffer);p.setUint16(0,i.size,!0);for(let e=0;e<i.size*fs;e++)p.setUint32(ds+e*4,n[e],!0);return f.set(r,ds+u),f}function gs(e,t){if(!Number.isSafeInteger(t)||t<=0||e.byteLength<ds)throw Error(`Invalid Float32 palette item count or header.`);if(t>1073741824/ps)throw Error(`Float32 palette exceeds the decoded texture byte limit.`);let n=new DataView(e.buffer,e.byteOffset,e.byteLength),r=n.getUint16(0,!0);if(r<1||r>ms||r>t||n.getUint16(2,!0)!==0)throw Error(`Invalid Float32 palette count or reserved fields.`);let i=ds+r*ps;if(e.byteLength!==i+t)throw Error(`Float32 palette payload length does not match its item count.`);for(let t=i;t<e.length;t++)if(e[t]>=r)throw Error(`Float32 palette index is out of range.`);let a=new Uint32Array(r*fs);for(let e=0;e<a.length;e++)a[e]=n.getUint32(ds+e*4,!0);let o=new Float32Array(t*fs),s=new Uint32Array(o.buffer);for(let n=0;n<t;n++){let t=e[i+n]*fs,r=n*fs;s[r]=a[t],s[r+1]=a[t+1],s[r+2]=a[t+2],s[r+3]=a[t+3]}return o}var _s=new Uint8Array(new Uint32Array([1]).buffer)[0]===1;function vs(e){if(e.length%ps!==0)return null;if(_s&&e.byteOffset%4==0)return hs(new Uint32Array(e.buffer,e.byteOffset,e.length/4));let t=new Uint32Array(e.length/4),n=new DataView(e.buffer,e.byteOffset,e.byteLength);for(let e=0;e<t.length;e++)t[e]=n.getUint32(e*4,!0);return hs(t)}function ys(e,t){let n=gs(e,t/ps),r=new Uint8Array(n.buffer);if(!_s){let e=new Uint32Array(n.buffer),t=new DataView(n.buffer);for(let n=0;n<e.length;n++)t.setUint32(n*4,e[n],!0)}return r}var bs=1,xs=720,Ss=Math.PI/xs,Cs=12,ws=15,Ts=4096,Es=4095,Ds=class{tuple;size=0;arity;keys;keySlots;slots;pendingSlot=-1;hashValue=new Float64Array(1);hashWords=new Uint32Array(this.hashValue.buffer);constructor(e,t=1024){this.arity=e,this.tuple=new Float64Array(e),this.keys=new Float64Array(t*e),this.keySlots=new Int32Array(t),this.slots=new Int32Array(t*2)}find(){let e=this.slots.length-1;for(let t=this.hash(this.tuple,0)&e;;t=t+1&e){let e=this.slots[t]-1;if(e<0)return this.pendingSlot=t,-1;if(this.matches(e))return e}}insert(){this.size===this.keySlots.length&&this.growEntries();let e=this.size++;return this.keys.set(this.tuple,e*this.arity),this.keySlots[e]=this.pendingSlot,this.slots[this.pendingSlot]=e+1,this.pendingSlot=-1,this.size*2>this.slots.length&&this.rehash(this.slots.length*2),e}clear(){for(let e=0;e<this.size;e++)this.slots[this.keySlots[e]]=0;this.size=0,this.pendingSlot=-1}matches(e){let t=e*this.arity;for(let e=0;e<this.arity;e++){let n=this.keys[t+e],r=this.tuple[e];if(n!==r&&(n===n||r===r))return!1}return!0}hash(e,t){let n=2166136261;for(let r=0;r<this.arity;r++){let i=e[t+r],a=0,o=2146959360;i===i&&i!==0?(this.hashValue[0]=i,a=this.hashWords[0],o=this.hashWords[1]):i===0&&(o=0),n=Math.imul(n^a,16777619),n=Math.imul(n^o,16777619)}return n^=n>>>16,Math.imul(n,2146121005)>>>0}growEntries(){let e=new Float64Array(this.keys.length*2);e.set(this.keys),this.keys=e;let t=new Int32Array(this.keySlots.length*2);t.set(this.keySlots),this.keySlots=t}rehash(e){this.slots=new Int32Array(e);let t=e-1;for(let e=0;e<this.size;e++){let n=this.hash(this.keys,e*this.arity)&t;for(;this.slots[n]!==0;)n=n+1&t;this.slots[n]=e+1,this.keySlots[e]=n}}},Os=class{pages=[];width;length=0;constructor(e){this.width=e}append(e,t,n=0){let r=this.length++,i=r>>>Cs,a=this.pages[i]??(this.pages[i]=new Uint32Array(Ts*this.width)),o=(r&Es)*this.width;return a[o]=e,a[o+1]=t,this.width===3&&(a[o+2]=n),r}get(e,t){return this.pages[e>>>Cs][(e&Es)*this.width+t]}set(e,t,n){this.pages[e>>>Cs][(e&Es)*this.width+t]=n}clear(){this.length=0,this.pages.length>1&&(this.pages.length=1)}},ks=class{groupIds=new Ds(ws);groups=new Os(3);members=new Os(2);tolerance;overview;readPrimitive;constructor(e,t,n){this.tolerance=e,this.overview=t,this.readPrimitive=n}get size(){return this.groups.length}add(e,t,n){As(this.groupIds.tuple,e,n,this.tolerance,this.overview);let r=this.groupIds.find(),i=this.members.append(t,0);r<0?(r=this.groups.append(i+1,i+1,n),this.groupIds.insert()):(this.members.set(this.groups.get(r,1)-1,1,i+1),this.groups.set(r,1,i+1))}*values(){for(let e=0;e<this.groups.length;e++){let t=this.groups.get(e,2),n=this.groups.get(e,0),r;for(;n!==0;){let e=n-1,i=this.readPrimitive(this.members.get(e,0));if(!i)throw Error(`LOD interval source changed during construction`);r??=js(i,t,this.tolerance,this.overview);let a=i.x1-i.x0,o=i.y1-i.y0,s=i.x0*r.normalX+i.y0*r.normalY,c=Math.hypot(a,o);r.offsetSum+=s*c,r.offsetWeightSum+=c;let l=i.visibleBounds;l&&(r.clipMinX=Math.min(r.clipMinX,l.minX),r.clipMinY=Math.min(r.clipMinY,l.minY),r.clipMaxX=Math.max(r.clipMaxX,l.maxX),r.clipMaxY=Math.max(r.clipMaxY,l.maxY)),Ms(r,i,this.tolerance),n=this.members.get(e,1)}r&&(yield r)}}clear(){this.groupIds.clear(),this.groups.clear(),this.members.clear()}};function As(e,t,n,r,i){let a=t.x1-t.x0,o=t.y1-t.y0,s=Math.atan2(o,a);s<0&&(s+=Math.PI),s>=Math.PI&&(s-=Math.PI);let c=Math.round(s/Ss);c>=xs&&(c=0);let l=c*Ss,u=Math.cos(l),d=-Math.sin(l),f=u,p=t.x0*d+t.y0*f,m=(t.flags&bs)!==0,h=!i&&!m&&t.halfWidth>0?Math.min(r,t.halfWidth*.02):r,g=Math.round(p/h),_=m?-1:t.halfWidth,v=t.flags&7,y=t.visibleBounds;e[0]=t.paintGroup??-1,e[1]=n,e[2]=v,e[3]=_,e[4]=Math.round(t.colorR*255),e[5]=Math.round(t.colorG*255),e[6]=Math.round(t.colorB*255),e[7]=Math.round(t.alpha*255),e[8]=c,e[9]=g,e[10]=+!!y,e[11]=y?y.minX:0,e[12]=y?y.minY:0,e[13]=y?y.maxX:0,e[14]=y?y.maxY:0}function js(e,t,n,r){let i=e.x1-e.x0,a=e.y1-e.y0,o=Math.atan2(a,i);o<0&&(o+=Math.PI),o>=Math.PI&&(o-=Math.PI);let s=Math.round(o/Ss);s>=xs&&(s=0);let c=s*Ss,l=Math.cos(c),u=Math.sin(c),d=-u,f=l,p=e.x0*d+e.y0*f,m=(e.flags&bs)!==0,h=!r&&!m&&e.halfWidth>0?Math.min(n,e.halfWidth*.02):n,g=Math.round(p/h),_=e.flags&7;return{paintOrder:e.paintOrder,paintGroup:e.paintGroup,tileIndex:t,axisX:l,axisY:u,normalX:d,normalY:f,offset:g*h,offsetSum:0,offsetWeightSum:0,clipMinX:1/0,clipMinY:1/0,clipMaxX:-1/0,clipMaxY:-1/0,halfWidth:e.halfWidth,flags:_,alpha:e.alpha,colorR:e.colorR,colorG:e.colorG,colorB:e.colorB,intervals:[]}}function Ms(e,t,n){let r=t.x0*e.axisX+t.y0*e.axisY,i=t.x1*e.axisX+t.y1*e.axisY,a=Math.min(r,i),o=Math.max(r,i),s=t.visibleBounds;if(s){let r=s.minX*e.axisX+s.minY*e.axisY,i=s.minX*e.axisX+s.maxY*e.axisY,c=s.maxX*e.axisX+s.minY*e.axisY,l=s.maxX*e.axisX+s.maxY*e.axisY,u=Math.max(t.halfWidth*4,n,.001);if(a=Math.max(a,Math.min(r,i,c,l)-u),o=Math.min(o,Math.max(r,i,c,l)+u),o<=a)return}e.intervals.push(a,o)}var Ns=new WeakMap,Ps=new WeakMap;function Fs(e){if(!e.drawRuns)return Ns.get(e);let t=Ns.get(e);if(!t){t=new Uint32Array(e.segmentCount);for(let e=0;e<t.length;e++)t[e]=e;Ns.set(e,t)}return t}function Is(e,t){t&&Ns.set(e,t)}function Ls(e){return Ns.get(e)}function Rs(e){return Ns.has(e)||e.drawRuns!==void 0}function zs(e,t){let n=Ns.get(e);return n?n[t]:e.drawRuns?t:void 0}function Bs(e){Ps.delete(e)}function Vs(e){if(!e.drawRuns)return;let t=Ps.get(e);if(t)return t;t=new Uint32Array(e.segmentCount);for(let n of e.drawRuns){if(n.kind!==`stroke`)continue;let r=n.first;for(let i=n.first;i<n.first+n.count;i++){let a=i*4,o=e.primitiveMeta[a+3],s=o-Math.floor(o/2+1e-6)*2;i>n.first&&(s<.999||o!==e.primitiveMeta[a-1]||e.styles[a+1]!==e.styles[a-3]||e.styles[a+2]!==e.styles[a-2]||e.styles[a+3]!==e.styles[a-1])&&(r=i),t[i]=r}}return Ps.set(e,t),t}var Hs=[`endpoints`,`primitiveMeta`,`primitiveBounds`,`styles`],Us=new WeakMap,Ws=new WeakMap,Gs=new WeakMap;function Ks(e,t){let n=Us.get(t);if(n)return n;let r=Math.max(0,e.segmentCount|0),i=[],a=r,o=(e,t)=>{t<=0||(i.push({base:a,scene:e}),a+=t)},s=t.find(e=>e.store)?.store;if(s){if(s.canonical!==e)throw Error(`Vector LOD store belongs to a different scene.`);o(s.literals,Math.max(0,s.literals.segmentCount|0))}let c=[],l=[];t.forEach((t,n)=>{if(t.store){if(t.store!==s)throw Error(`Vector LOD levels belong to different hierarchies.`);c.push(t.records??null),l.push(0);return}if(c.push(null),n===0&&t.scene===e){l.push(0);return}l.push(a),o(t.scene,Math.max(0,t.segmentCount|0))});let u={canonical:e,count:a,parts:i,records:c,bases:l};return Us.set(t,u),u}function qs(e){let t=[{first:0,count:Math.max(0,e.canonical.segmentCount|0),scene:e.canonical}];return e.parts.forEach((n,r)=>t.push({first:n.base,count:(e.parts[r+1]?.base??e.count)-n.base,scene:n.scene})),{count:e.count,segments:t}}function Js(e){let t=e.canonical,n=Math.max(0,t.segmentCount|0);if(!Rs(t))return;let r=new Uint32Array(e.count),i=Ls(t);if(i)r.set(i.subarray(0,n));else for(let e=0;e<n;e++)r[e]=e;for(let t of e.parts)r.set(Fs(t.scene),t.base);return r}function Ys(e,t){let n=Ws.get(t);if(n)return n;let r=Ks(e,t),i=qs(r),a={layout:r,records:i,textures:Gi(i)};return Ws.set(t,a),a}function Xs(e){if(!e.store)return e.scene;if(!e.records)return e.store.canonical;let t=Gs.get(e.records);return t||(t=Qs(e),Gs.set(e.records,t)),t}function Zs(e){return e.store?e.records?Gs.get(e.records)??Qs(e):e.store.canonical:e.scene}function Qs(e){let{canonical:t,literals:n}=e.store,r=Math.max(0,t.segmentCount|0),i=Math.max(0,e.segmentCount|0),a=e.records,o={...t,segmentCount:i,bounds:e.sceneBounds,maxHalfWidth:e.maxHalfWidth};for(let e of Hs){let s=new Float32Array(i*4),c=$s(s),l=$s(t[e]),u=$s(n[e]);for(let e=0;e<i;e++){let t=a[e],n=t<r?l:u,i=(t<r?t:t-r)*4;c[e*4]=n[i],c[e*4+1]=n[i+1],c[e*4+2]=n[i+2],c[e*4+3]=n[i+3]}o[e]=s}if(Rs(t)){let e=Fs(n),s=new Uint32Array(i);for(let n=0;n<i;n++){let i=a[n];s[n]=i<r?zs(t,i):e[i-r]}Is(o,s)}return o}function $s(e){return new Uint32Array(e.buffer,e.byteOffset,e.length)}var ec=new WeakMap;function tc(){let e=globalThis;return e.HEPR_DEBUG_DISABLE_COMPOSITING===!0||typeof e.location?.search==`string`&&new URLSearchParams(e.location.search).has(`noComposite`)}function nc(e){if(!e.paintGraph||tc())return!1;let t=ec.get(e);if(t!==void 0)return t;let n=e.drawRuns??[],r=0,i=e=>{for(let t of e)if(t.kind===`group`){if(t.alpha!==1||t.knockout||t.softMask||t.blendMode!==`Normal`||!i(t.children))return!1}else{let e=n[r];if(!e||(t.kind===`draw`?t.runIndex!==r:e.kind!==`raster`||e.first!==t.rasterIndex||e.count!==1)||e.blendMode)return!1;r++}return!0},a=!i(e.paintGraph.roots)||r!==n.length;return ec.set(e,a),a}var rc=class{requiresCompositing;orderedRuns;snapshot=null;eligible=new Set;visibleRuns=[];selected=[];allVisible=!0;scene;defaults;constructor(e){this.scene=e,this.orderedRuns=e.drawRuns??[],this.requiresCompositing=nc(e),this.defaults=n(e),this.setVisibility(this.defaults)}setVisibility(e){if(e??=this.defaults,this.snapshot===e)return;this.snapshot=e,this.eligible.clear();let t=t=>t===void 0||e.conditions[t]===1,n=[];for(let e of this.orderedRuns)c(this.scene,e,t)&&(this.eligible.add(e),n.push(e));this.allVisible=n.length===this.orderedRuns.length,this.visibleRuns=this.allVisible?this.orderedRuns:n}isRunVisible(e){return this.eligible.has(e)}select(e){if(this.allVisible)return e;if(e===this.orderedRuns)return this.visibleRuns;this.selected.length=0;for(let t of e)this.eligible.has(t)&&this.selected.push(t);return this.selected}},ic=15e4,ac=[.5,1,2,4,8,16,32],oc=5e4,sc=15,cc=class{ids=new Ds(sc,256);groups=[];get key(){return this.ids.tuple}get size(){return this.groups.length}values(){return this.groups}find(){let e=this.ids.find();return e>=0?this.groups[e]:void 0}add(e){this.ids.insert(),this.groups.push(e)}clear(){this.ids.clear(),this.groups.length=0}},lc={elapsedMs:0,buildCount:0,sourceSegmentCount:0,levelCount:0},uc=new WeakMap,dc=14,fc=16384,pc=class{chunks=[];width;length=0;constructor(e){this.width=e}push(e){let t=this.chunkFor(this.length);t[this.length&16383]=e,this.length++}push4(e,t){let n=this.chunkFor(this.length),r=(this.length&16383)*4;n[r]=e[t],n[r+1]=e[t+1],n[r+2]=e[t+2],n[r+3]=e[t+3],this.length++}truncate(e){this.length=Math.min(this.length,e),this.chunks.length=Math.ceil(this.length/fc)}toTypedArray(){let e=new Uint32Array(this.length*this.width),t=fc*this.width;for(let n=0;n<this.chunks.length;n++){let r=n*t;e.set(this.chunks[n].subarray(0,Math.min(t,e.length-r)),r),this.chunks[n]=new Uint32Array}return this.chunks.length=0,this.length=0,e}chunkFor(e){let t=e>>>dc;return this.chunks[t]??(this.chunks[t]=new Uint32Array(fc*this.width))}},mc=[`endpoints`,`primitiveMeta`,`primitiveBounds`,`styles`],hc=class{canonicalCount;canonical;canonicalWords;canonicalOrigins;hasOrigins;fields=mc.map(()=>new pc(4));literalOrigins;record=new Float32Array(16);recordWords=new Uint32Array(this.record.buffer);records=new pc(1);levelLiteralStart=0;literalCount=0;constructor(e){this.canonical=e,this.canonicalCount=Math.max(0,e.segmentCount|0),this.canonicalWords=mc.map(t=>{let n=e[t];return new Uint32Array(n.buffer,n.byteOffset,n.length)}),this.canonicalOrigins=Ls(e),this.hasOrigins=Rs(e),this.literalOrigins=this.hasOrigins?new pc(1):void 0}get levelRecordCount(){return this.records.length}beginLevel(){this.records=new pc(1),this.levelLiteralStart=this.literalCount}push(e,t,n,r,i,a){let o=this.record;o[0]=e.x0,o[1]=e.y0,o[2]=e.cx,o[3]=e.cy,o[4]=e.x1,o[5]=e.y1,o[6]=e.primitiveType,o[7]=e.alpha+e.flags*bc,o[8]=t,o[9]=n,o[10]=r,o[11]=i,o[12]=e.halfWidth,o[13]=e.colorR,o[14]=e.colorG,o[15]=e.colorB;let s=e.paintOrder??0,c=a>=0?a:this.hasOrigins&&e.paintOrder!==void 0?e.paintOrder:-1;if(c>=0&&c<this.canonicalCount&&(!this.hasOrigins||(this.canonicalOrigins?this.canonicalOrigins[c]:c)===s)&&this.matchesCanonical(c)){this.records.push(c);return}for(let e=0;e<mc.length;e++)this.fields[e].push4(this.recordWords,e*4);this.literalOrigins?.push(s),this.records.push(this.canonicalCount+this.literalCount++)}endLevel(e){if(!e){this.literalCount=this.levelLiteralStart;for(let e of this.fields)e.truncate(this.literalCount);return this.literalOrigins?.truncate(this.literalCount),this.records=new pc(1),null}let t=this.records.toTypedArray();return this.records=new pc(1),t}finish(){let e={...this.canonical,segmentCount:this.literalCount};return mc.forEach((t,n)=>{e[t]=new Float32Array(this.fields[n].toTypedArray().buffer)}),Is(e,this.literalOrigins?.toTypedArray()),e}matchesCanonical(e){let t=this.recordWords,n=e*4;for(let e=0;e<mc.length;e++){let r=this.canonicalWords[e],i=e*4;if(r[n]!==t[i]||r[n+1]!==t[i+1]||r[n+2]!==t[i+2]||r[n+3]!==t[i+3])return!1}return!0}},gc=0,_c=1,vc=2,yc=4,bc=2,xc=Math.PI/720,Sc=.985,Cc=1.25,wc=5,Tc=1e-12,Ec=[0,1,4,5],Dc=512,Oc=64,kc=256,Ac=4096,jc=12,Mc=96,Nc=.22,Pc=.45,Fc=.1,Ic=3.2,Lc=8192,Rc=1,zc=1.65,Bc=.18,Vc=1.15,Hc=16,Uc=8,Wc=.25,Gc=1.1,Kc=1.5,qc=.05,Jc=8,Yc=25e4,Xc=65535,Zc=192,Qc=class{levels;tileGrid;tileSelectedLevelIndices;projectedTileUnitsPerPixel;projectedTileWeights;projectedTileVisibleFractions;projectedTilePartial;projectedPlanes=new Float64Array(12);projectedClip=new Float64Array(32);projectedTileRect=new Float64Array(4);levelTileReach=[];projectedHalfWidth=1;projectedHalfHeight=1;projectedClipCut=!1;projectedRectDepth=0;projectedRectArea=0;maxHalfWidth;activeLevelIndex=0;forceExact=!1;useLocalToClip=!1;constantClipW=!1;finiteLocalToClip=!1;localToClip=new Float64Array(16);selectionProjectionBasis=new Float64Array(4);localUnitsPerPixel=1;lastVisibleSegmentCount=0;allLevelBounds={minX:1/0,minY:1/0,maxX:-1/0,maxY:-1/0};fullViewBaselineLevelIndex=-1;fullViewMaxLevelIndex=-1;selectionGuard=null;stats;constructor(e,t){let n=t?void 0:iu.get(e);n&&(t=du(e,n));let r=eu();if(this.tileGrid=t?.tileGrid??xl(e.bounds,Math.max(0,e.segmentCount|0),e),this.tileSelectedLevelIndices=new Int16Array(this.tileGrid.columns*this.tileGrid.rows),this.tileSelectedLevelIndices.fill(-1),this.projectedTileUnitsPerPixel=new Float64Array(this.tileGrid.columns*this.tileGrid.rows),this.projectedTileWeights=new Float64Array(this.tileGrid.columns*this.tileGrid.rows),this.projectedTileVisibleFractions=new Float64Array(this.tileGrid.columns*this.tileGrid.rows),this.projectedTilePartial=new Uint8Array(this.tileGrid.columns*this.tileGrid.rows),this.maxHalfWidth=Math.max(0,e.maxHalfWidth),this.levels=t?.levels??tl(il(e,this.tileGrid)),t?.allLevelBounds)Object.assign(this.allLevelBounds,t.allLevelBounds);else for(let e of this.levels){let t=e.records;for(let n=0;n<e.segmentCount;n++){let r=t?t[n]:n;this.allLevelBounds.minX=Math.min(this.allLevelBounds.minX,e.segmentMinX[r]),this.allLevelBounds.minY=Math.min(this.allLevelBounds.minY,e.segmentMinY[r]),this.allLevelBounds.maxX=Math.max(this.allLevelBounds.maxX,e.segmentMaxX[r]),this.allLevelBounds.maxY=Math.max(this.allLevelBounds.maxY,e.segmentMaxY[r])}}this.levels.length>0&&(this.activeLevelIndex=0),this.stats=this.createEmptyStats();let i=t?.elapsedMs??eu()-r;t?.elapsedMs!==0&&(tu(i,e.segmentCount,this.levels),_l(i,e.segmentCount,this.levels.length)),ou.set(e,new WeakRef(this))}setScreenSpaceTransform(){this.useLocalToClip&&(this.selectionGuard=null,this.fullViewBaselineLevelIndex=-1),this.useLocalToClip=!1}setForceExact(e){this.forceExact!==e&&(this.forceExact=e,this.selectionGuard=null,this.fullViewBaselineLevelIndex=-1,this.tileSelectedLevelIndices.fill(-1))}setLocalToClipTransform(e,t){let n=!0,r=this.useLocalToClip&&this.constantClipW;for(let t=0;t<16;t+=1){let r=Number(e[t]);n&&=Number.isFinite(r),this.localToClip[t]=r||0}this.finiteLocalToClip=n;let i=this.localToClip,a=Math.max(Math.abs(this.tileGrid.minX),Math.abs(this.tileGrid.maxX),Math.abs(this.allLevelBounds.minX),Math.abs(this.allLevelBounds.maxX)),o=Math.max(Math.abs(this.tileGrid.minY),Math.abs(this.tileGrid.maxY),Math.abs(this.allLevelBounds.minY),Math.abs(this.allLevelBounds.maxY)),s=i[15],c=Math.abs(i[3])*a+Math.abs(i[7])*o;this.constantClipW=n&&Math.abs(s)>1e-8&&Number.isFinite(c)&&c<=Math.abs(s)*Tc;for(let e=0;e<2&&r;e++){let t=i[e]/s,n=i[e+4]/s,a=this.selectionProjectionBasis[e],o=this.selectionProjectionBasis[e+2],c=Math.max(Math.abs(t),Math.abs(n),Math.abs(a),Math.abs(o))*Tc;(Math.abs(t-a)>c||Math.abs(n-o)>c)&&(r=!1)}if(!this.constantClipW||!r){this.selectionGuard=null,this.fullViewBaselineLevelIndex=-1;for(let e=0;e<Ec.length;e++)this.selectionProjectionBasis[e]=i[Ec[e]]/s}this.useLocalToClip=!0,this.localUnitsPerPixel=Ql(t)}updateForLocalUnitsPerPixel(e){return this.localUnitsPerPixel=Ql(e),this.activeLevelIndex=this.chooseLevelIndex(this.localUnitsPerPixel),this.activeLevelIndex>0}update(e,t,n){return this.levels.length<=0?(this.lastVisibleSegmentCount=0,this.stats=this.createEmptyStats(),!0):this.updateTiledVisibleSegments(e,t,n)}getStats(){return{...this.stats,activeLevels:this.stats.activeLevels.map(e=>({...e}))}}resetVisible(){this.fullViewBaselineLevelIndex=-1,this.selectionGuard=null,this.lastVisibleSegmentCount=0;for(let e of this.levels)e.visibleSegmentCount=0;this.stats=this.createEmptyStats()}estimateVisibleSegmentCount(){return this.lastVisibleSegmentCount>0?this.lastVisibleSegmentCount:this.levels[this.activeLevelIndex]?.segmentCount??0}getRenderedSegmentCount(){return this.lastVisibleSegmentCount}chooseLevelIndex(e,t=Cc,n=!1){if(this.forceExact)return 0;let r=e*t;for(let e=this.levels.length-1;e>=1;--e)if((!n||this.levels[e].overview)&&this.levels[e].tolerance<=r)return e;return 0}updateTiledVisibleSegments(e,t,n){let r=El(e,t,n,this.maxHalfWidth),i=this.chooseLevelIndex(this.localUnitsPerPixel),a=Math.max(i,this.chooseLevelIndex(this.localUnitsPerPixel,wc,!0)),o=Al(r.minX,r.minY,r.maxX,r.maxY,this.tileGrid),s=!this.useLocalToClip||this.constantClipW&&n!=null&&[n.minX,n.minY,n.maxX,n.maxY].every(Number.isFinite)&&n.minX<=n.maxX&&n.minY<=n.maxY,c=s&&o!==null&&o.c0===0&&o.r0===0&&o.c1===this.tileGrid.columns-1&&o.r1===this.tileGrid.rows-1&&r.minX<=this.allLevelBounds.minX&&r.minY<=this.allLevelBounds.minY&&r.maxX>=this.allLevelBounds.maxX&&r.maxY>=this.allLevelBounds.maxY;if(c&&this.fullViewBaselineLevelIndex===i&&this.fullViewMaxLevelIndex===a)return!1;let l=s&&this.levels[0].segmentCount>=15e4&&[r.minX,r.minY,r.maxX,r.maxY].every(Number.isFinite)?Oc*this.localUnitsPerPixel:0,u=this.selectionGuard;if(l>0&&u&&o&&u.baseline===i&&u.maxLevel===a&&u.range.c0===o.c0&&u.range.c1===o.c1&&u.range.r0===o.r0&&u.range.r1===o.r1&&r.minX>=u.bounds.minX&&r.minY>=u.bounds.minY&&r.maxX<=u.bounds.maxX&&r.maxY<=u.bounds.maxY&&u.bounds.maxX-u.bounds.minX<=r.maxX-r.minX+l*4&&u.bounds.maxY-u.bounds.minY<=r.maxY-r.minY+l*4)return!1;if(this.selectionGuard=null,this.fullViewBaselineLevelIndex=-1,this.resetLevelDrawLists(),!o)return this.lastVisibleSegmentCount=0,this.updateLevelStats(0,0,0,0,i,0,i,i),!0;let d=l>0?{minX:r.minX-l,minY:r.minY-l,maxX:r.maxX+l,maxY:r.maxY+l}:null,f=d&&[d.minX,d.minY,d.maxX,d.maxY].every(Number.isFinite)?d:r,p=this.useLocalToClip&&!this.constantClipW?this.projectTiles(o,t):-1,m=p>=0,h=0,g=0;for(let e=o.r0;e<=o.r1;e++)for(let t=o.c0;t<=o.c1;t++){let n=e*this.tileGrid.columns+t;m&&this.projectedTileUnitsPerPixel[n]<0||(h++,this.levels[0].tileCounts[n]>0&&g++)}let _=Math.max(Rc,Math.ceil(oc/Math.max(1,g))),v=m?this.levels.length:i,y=0,b=0,x=0,S=i,C=0,w=i,T=!this.forceExact&&this.levels.some(e=>e.overview),E=oc*zc;for(let e=0;e<2;e++){e>0&&(this.resetLevelDrawLists(),v=m?this.levels.length:i,y=0,b=0,C=0);let t=0;selectTiles:for(let n=o.r0;n<=o.r1;n+=1)for(let r=o.c0;r<=o.c1;r+=1){let o=n*this.tileGrid.columns+r,s=this.levels[0].tileCounts[o],c=i,l=a,u=_,d=null;if(m){let e=this.projectedTileUnitsPerPixel[o];if(e<0||s===0)continue;for(c=this.chooseLevelIndex(e),l=Math.max(c,this.chooseLevelIndex(e,wc,!0));l>0&&!this.tileReachWithinBudget(o,l);)l--;c=Math.min(c,l),p>0&&(u=Math.max(Rc,Math.round(oc*this.projectedTileWeights[o]/p))),y+=u,this.projectedTilePartial[o]&&(d=this.projectedPlanes),v=Math.min(v,c)}let h=this.chooseTileLevel(o,u,c,l,e>0),g=this.levels[h].tileCounts[o];s>b&&(b=s,x=g,S=h),g>C&&(C=g,w=h);let D=this.levels[h],O=D.visibleSegmentCount;if(Dl(D,o,f,d,T&&e===0?82501-t:1/0),t+=D.visibleSegmentCount-O,T&&e===0&&t>E)break selectTiles}if(!T||t<=E)break}return m&&(v>=this.levels.length&&(v=i),g>0&&(_=Math.round(y/g))),this.activeLevelIndex=v,this.updateLevelStats(h,_,b,x,S,C,w,v),c&&(this.fullViewBaselineLevelIndex=i,this.fullViewMaxLevelIndex=a),f!==r&&(this.selectionGuard={bounds:f,range:o,baseline:i,maxLevel:a}),!0}resetLevelDrawLists(){for(let e of this.levels)e.visibleSegmentCount=0,e.markToken+=1,e.markToken>=2**(8*e.segmentMarks.BYTES_PER_ELEMENT)-1&&(e.segmentMarks.fill(0),e.markToken=1)}chooseTileLevel(e,t,n,r,i=!1){if(this.forceExact||this.levels[0].tileCounts[e]<=t)return this.tileSelectedLevelIndices[e]=0,0;for(let r=1;r<=n;r++)if(!this.levels[r].overview&&this.levels[r].tileCounts[e]<=t)return this.tileSelectedLevelIndices[e]=r,r;let a=this.chooseTargetBalancedTileLevel(e,t,r),o=Math.max(1,t*zc);if(i&&this.levels[a].tileCounts[e]>o)for(let t=r+1;t<this.levels.length;t++){if(!this.levels[t].overview)continue;let n=this.levels[t].tileCounts[e];if(n<this.levels[a].tileCounts[e]&&(a=t),n<=o)break}let s=this.tileSelectedLevelIndices[e];if(s>=0&&s<=r){let n=this.levels[s].tileCounts[e];if(n<=o){let r=this.levels[a].tileCounts[e];if(Pl(n,t)<=Pl(r,t)+Math.max(2,t*Bc))return s}}return this.tileSelectedLevelIndices[e]=a,a}chooseTargetBalancedTileLevel(e,t,n){let r=Math.max(1,t*zc),i=-1,a=1/0,o=1/0,s=n;for(let c=0;c<=n;c+=1){let n=this.levels[c].tileCounts[e];if((n<o||n===o&&c<s)&&(o=n,s=c),n>r)continue;let l=Pl(n,t);(l<a||l===a&&(i<0||c<i))&&(a=l,i=c)}return i>=0?i:s}projectTiles(e,t){if(!this.finiteLocalToClip)return-1;let n=this.localToClip;this.projectedHalfWidth=Math.max(1,t.width)*.5,this.projectedHalfHeight=Math.max(1,t.height)*.5;let r=this.projectedPlanes;for(let e=0;e<2;e++){let t=1+Hc/(e===0?this.projectedHalfWidth:this.projectedHalfHeight);for(let i=0;i<2;i++){let a=i===0?1:-1,o=(e*2+i)*3;r[o]=n[3]*t+a*n[e],r[o+1]=n[7]*t+a*n[4+e],r[o+2]=n[15]*t+a*n[12+e]}}let i=this.tileGrid,a=this.projectedTileRect,o=1/0;for(let t=e.r0;t<=e.r1;t++)for(let n=e.c0;n<=e.c1;n++){let e=t*i.columns+n;this.readProjectedTileRect(e);let r=this.projectRect(a[0],a[1],a[2],a[3]);this.projectedTileUnitsPerPixel[e]=r,!(r<0)&&(o=Math.min(o,this.projectedRectDepth),this.projectedTileWeights[e]=this.projectedRectDepth,this.projectedTilePartial[e]=+!!this.projectedClipCut,this.projectedTileVisibleFractions[e]=Math.min(1,this.projectedRectArea/Math.max(1e-300,(a[2]-a[0])*(a[3]-a[1]))))}let s=0;for(let t=e.r0;t<=e.r1;t++)for(let n=e.c0;n<=e.c1;n++){let e=t*i.columns+n;if(this.projectedTileUnitsPerPixel[e]<0)continue;let r=this.projectedTileWeights[e],a=o>0?o/r:r>0?0:1,c=a*a*a;this.projectedTileWeights[e]=c,this.levels[0].tileCounts[e]>0&&(s+=c*this.projectedTileVisibleFractions[e])}return s}readProjectedTileRect(e){let t=this.tileGrid,n=e%t.columns,r=(e-n)/t.columns,i=this.projectedTileRect,a=(t.xEdges[n+1]-t.xEdges[n])*Wc,o=(t.yEdges[r+1]-t.yEdges[r])*Wc;i[0]=(n===0?Math.min(t.xEdges[0],this.allLevelBounds.minX):t.xEdges[n])-a,i[1]=(r===0?Math.min(t.yEdges[0],this.allLevelBounds.minY):t.yEdges[r])-o,i[2]=(n===t.columns-1?Math.max(t.xEdges[n+1],this.allLevelBounds.maxX):t.xEdges[n+1])+a,i[3]=(r===t.rows-1?Math.max(t.yEdges[r+1],this.allLevelBounds.maxY):t.yEdges[r+1])+o}projectRect(e,t,n,r){let i=this.clipRectToFrustum(e,t,n,r);if(i<3)return-1;let a=this.localToClip,o=this.projectedClip,s=this.projectedHalfWidth,c=this.projectedHalfHeight,l=1/0,u=0,d=0,f=0;for(let e=0;e<i;e++){let t=o[e*2],n=o[e*2+1],r=a[0]*t+a[4]*n+a[12],p=a[1]*t+a[5]*n+a[13],m=a[3]*t+a[7]*n+a[15],h=(a[0]*m-r*a[3])*s,g=(a[4]*m-r*a[7])*s,_=(a[1]*m-p*a[3])*c,v=(a[5]*m-p*a[7])*c,y=h*h+g*g+_*_+v*v,b=h*v-g*_;u=Math.max(u,Math.sqrt(.5*(y+Math.sqrt(Math.max(0,y*y-4*b*b))))),l=Math.min(l,m),d+=m;let x=e+1<i?e+1:0;f+=t*o[x*2+1]-o[x*2]*n}return this.projectedRectDepth=Math.max(0,d/i),this.projectedRectArea=Math.abs(f)*.5,l>0?u>0?l*l/u:1/0:0}tileReachWithinBudget(e,t){let n=this.getLevelTileReach(t),r=e*4,i=n[r],a=n[r+1],o=n[r+2],s=n[r+3];if(!(i<=o&&a<=s))return!0;this.readProjectedTileRect(e);let c=this.projectedTileRect;if(i>=c[0]&&a>=c[1]&&o<=c[2]&&s<=c[3])return!0;let l=this.projectRect(i,a,o,s);return l<0||this.levels[t].tolerance<=l*wc}getLevelTileReach(e){let t=this.levelTileReach[e];if(t)return t;let n=this.levels[e],r=this.tileGrid.columns*this.tileGrid.rows;t=new Float32Array(r*4);let i=n.records;for(let e=0;e<r;e++){let r=1/0,a=1/0,o=-1/0,s=-1/0,c=n.tileOffsets[e],l=c+n.tileCounts[e];for(let e=c;e<l;e++){let t=i?i[n.tileSegmentIds[e]]:n.tileSegmentIds[e];r=Math.min(r,n.segmentMinX[t]),a=Math.min(a,n.segmentMinY[t]),o=Math.max(o,n.segmentMaxX[t]),s=Math.max(s,n.segmentMaxY[t])}t[e*4]=r,t[e*4+1]=a,t[e*4+2]=o,t[e*4+3]=s}return this.levelTileReach[e]=t,t}clipRectToFrustum(e,t,n,r){let i=this.projectedClip,a=this.projectedPlanes;i[0]=e,i[1]=t,i[2]=n,i[3]=t,i[4]=n,i[5]=r,i[6]=e,i[7]=r;let o=4,s=0,c=!1;for(let e=0;e<a.length&&o>0;e+=3){let t=a[e],n=a[e+1],r=a[e+2],l=16-s,u=0,d=i[s+o*2-2],f=i[s+o*2-1],p=t*d+n*f+r;for(let e=0;e<o;e++){let a=i[s+e*2],o=i[s+e*2+1],m=t*a+n*o+r;if(m>=0!=p>=0&&u<Uc){let e=p/(p-m);i[l+u*2]=d+(a-d)*e,i[l+u*2+1]=f+(o-f)*e,u++}m<0?c=!0:u<Uc&&(i[l+u*2]=a,i[l+u*2+1]=o,u++),d=a,f=o,p=m}o=u,s=l}return this.projectedClipCut=c,o}updateLevelStats(e,t,n,r,i,a,o,s){let c=0,l=[];for(let e=0;e<this.levels.length;e+=1){let t=this.levels[e],n=t.visibleSegmentCount;c+=n,n>0&&l.push({index:e,overview:t.overview,tolerance:t.tolerance,renderedSegments:n})}this.lastVisibleSegmentCount=c,this.stats={renderedSegments:c,visibleTileCount:e,targetSegmentsPerTile:t,baselineLevelIndex:s,baselineTolerance:this.levels[s]?.tolerance??0,activeLevels:l,maxBaselineTileSegments:n,maxBaselineTileSelectedSegments:r,maxBaselineTileSelectedLevelIndex:i,maxBaselineTileSelectedTolerance:this.levels[i]?.tolerance??0,maxSelectedTileSegments:a,maxSelectedTileLevelIndex:o,maxSelectedTileTolerance:this.levels[o]?.tolerance??0,tileGridColumns:this.tileGrid.columns,tileGridRows:this.tileGrid.rows,totalLevels:this.levels.length}}createEmptyStats(){return{renderedSegments:0,visibleTileCount:0,targetSegmentsPerTile:0,baselineLevelIndex:this.activeLevelIndex,baselineTolerance:this.levels[this.activeLevelIndex]?.tolerance??0,activeLevels:[],maxBaselineTileSegments:0,maxBaselineTileSelectedSegments:0,maxBaselineTileSelectedLevelIndex:this.activeLevelIndex,maxBaselineTileSelectedTolerance:this.levels[this.activeLevelIndex]?.tolerance??0,maxSelectedTileSegments:0,maxSelectedTileLevelIndex:this.activeLevelIndex,maxSelectedTileTolerance:this.levels[this.activeLevelIndex]?.tolerance??0,tileGridColumns:this.tileGrid.columns,tileGridRows:this.tileGrid.rows,totalLevels:this.levels.length}}};function $c(e,t,n){return e===`off`||t!==`webgl`&&t!==`webgpu`?!1:e===`force`?n>0:n>=ic}function el(e,t){let n=e.segmentCount>5e4&&(t??(!nc(e)&&!e.drawRuns?.some(e=>e.blendMode)));return[...n?[{tolerance:ac[0],overview:!1}]:[],...ac.map(e=>({tolerance:e,overview:n}))]}function tl(e){for(;;){let t=e.next();if(t.done)return t.value}}async function nl(e,t){try{for(;;){let n=e.next();if(n.done)return n.value;n.value.yieldable?await t.maybeYield(!1,n.value.value,n.value.message):t.report(n.value.value,n.value.message)}}finally{e.return(void 0)}}function*rl(e,t){let n=Math.max(0,e.segmentCount|0),r=new hc(e),i=[{tolerance:0,segmentCount:n,sceneBounds:e.bounds,maxHalfWidth:e.maxHalfWidth}],a=n,o=el(e,t),s=o.length;try{for(let t=0;t<s;t+=1){let{tolerance:n,overview:c}=o[t],l=.06+t/s*.62,u=.06+(t+1)/s*.62;yield{value:l,message:`Simplifying Vector LOD ${t+1}/${s}`,yieldable:!1};let d=yield*ml(e,n,c,r,l,u),f=d!==null&&d.segmentCount>0&&d.segmentCount<a*Sc,p=r.endLevel(f);d&&p&&(i.push({tolerance:n,overview:c,segmentCount:d.segmentCount,records:p,sceneBounds:d.bounds,maxHalfWidth:d.maxHalfWidth}),a=d.segmentCount)}}finally{Bs(e)}return{store:{canonical:e,literals:r.finish()},levels:i}}function*il(e,t,n){let r=yield*rl(e,n),i=yield*ol(r.store,.68,.72),a=[],o=Math.max(1,r.levels.length);for(let e=0;e<r.levels.length;e+=1){let n=r.levels[e],s=.72+e/o*.26,c=.72+(e+1)/o*.26;yield{value:s,message:`Building Vector LOD buckets ${e+1}/${r.levels.length}`,yieldable:!1};let l=yield*sl(n.records,n.segmentCount,i,t,s,c);a.push(new al(r.store,n,l,i))}return a}var al=class{overview;tolerance;segmentCount;records;store;sceneBounds;maxHalfWidth;tileOffsets;tileCounts;tileSegmentIds;segmentMarks;segmentMinX;segmentMinY;segmentMaxX;segmentMaxY;visibleSegmentIds;visibleSegmentCount=0;markToken=1;constructor(e,t,n,r){this.overview=t.overview,this.tolerance=t.tolerance,this.segmentCount=t.segmentCount,this.records=t.records,this.store=e,this.sceneBounds=t.sceneBounds,this.maxHalfWidth=t.maxHalfWidth,this.tileOffsets=n.tileOffsets,this.tileCounts=n.tileCounts,this.tileSegmentIds=n.tileSegmentIds,this.segmentMarks=new Uint8Array(t.segmentCount),this.segmentMinX=r.minX,this.segmentMinY=r.minY,this.segmentMaxX=r.maxX,this.segmentMaxY=r.maxY,this.visibleSegmentIds=new Uint32Array(Math.max(1,Math.min(4096,t.segmentCount)))}get scene(){return Xs(this)}};function*ol(e,t,n){let r=Math.max(0,e.canonical.segmentCount|0),i=r+Math.max(0,e.literals.segmentCount|0),a=new Float32Array(i),o=new Float32Array(i),s=new Float32Array(i),c=new Float32Array(i),l={minX:0,minY:0,maxX:0,maxY:0};for(let u=0;u<i;u+=1){u<r?kl(e.canonical,u,l):kl(e.literals,u-r,l);let d=.35;a[u]=l.minX-d,o[u]=l.minY-d,s[u]=l.maxX+d,c[u]=l.maxY+d,u&8191||(yield{value:t+(n-t)*(u/Math.max(1,i)),message:`Preparing Vector LOD bounds`,yieldable:!0})}return{minX:a,minY:o,maxX:s,maxY:c}}function*sl(e,t,n,r,i,a,o=1/0){let s=0,c=r.columns*r.rows,l=new Uint32Array(c),u={c0:0,c1:0,r0:0,r1:0};for(let c=0;c<t;c+=1){let d=e?e[c]:c;if(jl(n.minX[d],n.minY[d],n.maxX[d],n.maxY[d],r,u)){if(s+=(u.r1-u.r0+1)*(u.c1-u.c0+1),s>o)throw Error(`Vector LOD tile index resource limit exceeded`);for(let e=u.r0;e<=u.r1;e+=1){let t=e*r.columns+u.c0;for(let e=u.c0;e<=u.c1;e+=1)l[t]+=1,t+=1}}c&4095||(yield{value:i+(a-i)*.5*c/Math.max(1,t),message:`Counting Vector LOD tiles`,yieldable:!0})}let d=new Uint32Array(c+1);for(let e=0;e<c;e+=1)d[e+1]=d[e]+l[e];let f=new Uint32Array(d[c]),p=d.slice(0,c);for(let o=0;o<t;o+=1){let s=e?e[o]:o;if(jl(n.minX[s],n.minY[s],n.maxX[s],n.maxY[s],r,u))for(let e=u.r0;e<=u.r1;e+=1){let t=e*r.columns+u.c0;for(let e=u.c0;e<=u.c1;e+=1){let e=p[t];f[e]=o,p[t]=e+1,t+=1}}o&4095||(yield{value:i+(a-i)*(.5+.5*o/Math.max(1,t)),message:`Assigning Vector LOD tiles`,yieldable:!0})}return{tileOffsets:d,tileCounts:l,tileSegmentIds:f}}async function cl(e,t,n,r={}){return ul(e,t,n,r,!0)}async function ll(e,t,n,r={}){let i=await ul(e,t,n,r,!1);return i?{take(t){if(t!==e)throw Error(`Vector LOD reservation belongs to a different scene.`);if(!i)throw Error(`Vector LOD reservation has already been consumed or released.`);let n=i;return i=null,n},release(){if(!i)return;let t=i;i=null,fl(e,t)}}:null}async function ul(e,t,n,r,i){if(!$c(t,n,e.segmentCount))return null;let a=new yl(r),o=eu();a.report(0,`Preparing Vector LOD`);let s=dl(e);if(s){let t=!1;try{return await a.maybeYield(!0,.99,`Reusing Vector LOD`),a.report(1,`Vector LOD ready`),t=!0,s}finally{(i||!t)&&pl(e,s)}}if(iu.get(e)){if(r.signal?.aborted||r.shouldCancel?.())throw new vl;let t=new Qc(e);i&&pl(e,t);try{if(a.report(1,`Stored Vector LOD ready`),r.signal?.aborted||r.shouldCancel?.())throw new vl}catch(n){throw i||pl(e,t),n}return t}let c=null;if(typeof Worker<`u`&&e.segmentCount>=15e4){let t;try{t=await ze(()=>import(`./lodWorkerClient-DmY8da4m.js`),[],import.meta.url)}catch(e){console.warn(`[HEPR] LOD worker module unavailable; preparing cooperatively.`,e)}t&&(c=await t.buildVectorLodInWorker(e,void 0,{...r,onProgress:e=>a.report(e.value,e.message)}))}let l;if(c){let t=c.data;au.set(t,c),l=du(e,t),l.elapsedMs=eu()-o}else{let t=xl(e.bounds,Math.max(0,e.segmentCount|0),e);await a.maybeYield(!0,.04,`Partitioning stroke density`),l={tileGrid:t,levels:await nl(il(e,t),a),elapsedMs:eu()-o}}a.report(.99,`Finalizing Vector LOD`),await a.maybeYield(!0,.99,`Finalizing Vector LOD`),l.elapsedMs=eu()-o;let u=new Qc(e,l);i&&pl(e,u);try{a.report(1,`Vector LOD ready`)}catch(t){throw i||pl(e,u),t}return u}function dl(e){let t=uc.get(e)??null;return uc.delete(e),t}function fl(e,t){t.setForceExact(!1),t.resetVisible(),pl(e,t)}function pl(e,t){uc.set(e,t)}function*ml(e,t,n,r,i,a){r.beginLevel();let o=Math.max(0,e.segmentCount|0);if(o<=0||t<=0)return null;let s=$l(t),c=`Simplifying ${s}`,l=`Aggregating ${s}`,u=`Merging ${s}`,d=(e,t)=>({value:i+(a-i)*e,message:t,yieldable:!0}),f=Jl(e.bounds,t),p=new ks(t,n,t=>Il(e,t)),m=!n&&!nc(e)&&!e.drawRuns?.some(e=>e.blendMode)?new cc:null,h=Xl(),g=0,_=NaN,v=NaN,y=NaN,b=Fl(e),x,S=0;for(let i=0;i<o;i+=1){i&4095||(yield d(i/Math.max(1,o)*.72,c));let a=Il(e,i);if(!a||a.alpha<=.001)continue;let s=b&&a.paintGroup!==x;if(s||(m||n)&&!e.drawRuns&&(a.colorR!==_||a.colorG!==v||a.colorB!==y)){let c=0;for(let n of m?.values()??[])Bl(e,n,r,h,t*qc),++c&1023||(yield d(.72*i/Math.max(1,o),l));if(n||s){for(let e of p.values())Ul(e,r,h,t),++c&1023||(yield d(.72*i/Math.max(1,o),u));p.clear()}s&&(S+=m?.size??0),m?.clear(),x=a.paintGroup,_=a.colorR,v=a.colorG,y=a.colorB}if(n&&Vl(a,t))continue;if(m&&Ll(m,a,i,t,S)){g=Math.max(g,a.halfWidth);continue}if(a.primitiveType>=.5||!n&&Hl(a,t)){Gl(r,h,a,i),g=Math.max(g,a.halfWidth);continue}let C=a.x1-a.x0,w=a.y1-a.y0;if(C===0&&w===0){(a.flags&vc)!==0&&(Gl(r,h,a,i),g=Math.max(g,a.halfWidth));continue}let T=Yl(Kl(a),ql(a),e.bounds,f);p.add(a,i,T),g=Math.max(g,a.halfWidth)}let C=0;for(let n of m?.values()??[])Bl(e,n,r,h,t*qc),++C&1023||(yield d(.72,l));let w=0,T=Math.max(1,p.size);for(let e of p.values())Ul(e,r,h,t),w+=1,w&1023||(yield d(.72+.28*w/T,u));p.clear(),m?.clear();let E=r.levelRecordCount;return E===0?null:{segmentCount:E,bounds:Zl(h,e.bounds),maxHalfWidth:g}}function hl(){lc={elapsedMs:0,buildCount:0,sourceSegmentCount:0,levelCount:0}}function gl(){let e={...lc};return hl(),e}function _l(e,t,n){lc.elapsedMs+=Math.max(0,e),lc.buildCount+=1,lc.sourceSegmentCount+=Math.max(0,t|0),lc.levelCount+=Math.max(0,n|0)}var vl=class extends Error{constructor(){super(`Vector LOD build cancelled.`),this.name=`VectorStrokeLodBuildCancelledError`}},yl=class{yieldIntervalMs;onProgress;shouldCancel;signal;lastYieldAt=eu();lastProgressValue=-1;constructor(e){this.yieldIntervalMs=Math.max(50,Math.trunc(e.yieldIntervalMs??50)),this.onProgress=e.onProgress,this.shouldCancel=e.shouldCancel,this.signal=e.signal}report(e,t){let n=nu(e);n<this.lastProgressValue&&this.lastProgressValue>=0||(this.lastProgressValue=n,this.onProgress?.({value:n,message:t}))}async maybeYield(e,t,n){if(this.signal?.aborted||this.shouldCancel?.())throw new vl;this.report(t,n);let r=eu();if(!(!e&&r-this.lastYieldAt<this.yieldIntervalMs)&&(await bl(),this.lastYieldAt=eu(),this.signal?.aborted||this.shouldCancel?.()))throw new vl}};function bl(){return new Promise(e=>{globalThis.setTimeout(e,0)})}function xl(e,t,n){let r=Math.max(1e-6,e.maxX-e.minX),i=Math.max(1e-6,e.maxY-e.minY),a=H(Math.round(Math.max(1,t)/Dc),kc,Ac),o=r/i,s=Math.round(Math.sqrt(a*o)),c=Math.round(a/Math.max(1,s));s=H(s,jc,Mc),c=H(c,jc,Mc);let l=Sl(e.minX,e.maxX,s,n,`x`),u=Sl(e.minY,e.maxY,c,n,`y`);return{columns:s,rows:c,minX:e.minX,minY:e.minY,maxX:e.maxX,maxY:e.maxY,tileWidth:r/s,tileHeight:i/c,xEdges:l,yEdges:u}}function Sl(e,t,n,r,i){if(!r||n<=1||r.segmentCount<=n*4)return Tl(e,t,n);let a=Math.max(1e-9,t-e),o=Math.max(0,r.segmentCount|0),s=H(n*16,256,4096),c=new Float64Array(s),l=new Map,u={minX:0,minY:0,maxX:0,maxY:0},d=0;for(let t=0;t<o;t+=1){kl(r,t,u);let n=i===`x`?u.minX:u.minY,o=i===`x`?u.maxX:u.maxY,f=(n+o)*.5;if(!Number.isFinite(f))continue;let p=(f-e)/a,m=H(Math.floor(p*s),0,s-1),h=H(Math.floor((Math.min(n,o)-e)/a*s),0,s-1),g=H(Math.floor((Math.max(n,o)-e)/a*s),0,s-1),_=wl(r,t);c[m]+=Pc,Cl(l,_,m,1),h!==m&&(c[h]+=Fc,Cl(l,_,h,Fc)),g!==m&&g!==h&&(c[g]+=Fc,Cl(l,_,g,Fc)),d+=1}if(d<=n)return Tl(e,t,n);for(let[e,t]of l){let n=e%Lc;c[n]+=Math.sqrt(Math.max(0,t))*Ic}let f=Math.max(1e-6,d/s*.015),p=0;for(let e=0;e<s;e+=1)c[e]+=f,p+=c[e];let m=new Float64Array(n+1);m[0]=e,m[n]=t;let h=a/n*Nc,g=0,_=0;for(let r=1;r<n;r+=1){let i=p*r/n;for(;g<s-1&&_+c[g]<i;)_+=c[g],g+=1;let o=Math.max(1e-9,c[g]),l=ru((i-_)/o,0,1),u=e+(g+l)/s*a,d=m[r-1]+h,f=t-(n-r)*h;m[r]=ru(u,d,f)}return m}function Cl(e,t,n,r){let i=t*Lc+n;e.set(i,(e.get(i)??0)+r)}function wl(e,t){let n=t*4,r=Math.max(0,e.styles[n]??0),i=e.primitiveMeta[n+3]??0,a=Math.max(0,Math.floor(i/bc+1e-6)),o=nu(i-a*bc),s=H(Math.round(Math.log1p(r)*32),0,255),c=a&3,l=H(Math.round(o*15),0,15),u=H(Math.round(nu(e.styles[n+1]??0)*31),0,31),d=H(Math.round(nu(e.styles[n+2]??0)*31),0,31),f=H(Math.round(nu(e.styles[n+3]??0)*31),0,31);return((((s*4+c)*16+l)*32+u)*32+d)*32+f}function Tl(e,t,n){let r=new Float64Array(n+1),i=t-e;for(let t=0;t<=n;t+=1)r[t]=e+i*t/n;return r[0]=e,r[n]=t,r}function El(e,t,n,r){let i=Math.max(1e-6,e.zoom),a=Math.max(1,t.width)/(2*i),o=Math.max(1,t.height)/(2*i),s=Math.max(16/i,r*2,.5);return n?{minX:n.minX-s,minY:n.minY-s,maxX:n.maxX+s,maxY:n.maxY+s}:{minX:e.cameraCenterX-a-s,minY:e.cameraCenterY-o-s,maxX:e.cameraCenterX+a+s,maxY:e.cameraCenterY+o+s}}function Dl(e,t,n,r=null,i=1/0){let a=e.tileOffsets[t],o=a+e.tileCounts[t],s=e.records,c=e.visibleSegmentCount,l=c+i;for(let t=a;t<o&&c<l;t+=1){let i=e.tileSegmentIds[t];if(e.segmentMarks[i]===e.markToken)continue;let a=s?s[i]:i,o=e.segmentMinX[a],l=e.segmentMinY[a],u=e.segmentMaxX[a],d=e.segmentMaxY[a];if(!(u<n.minX||o>n.maxX||d<n.minY||l>n.maxY)&&(!r||Ol(r,o,l,u,d))){if(e.segmentMarks[i]=e.markToken,c===e.visibleSegmentIds.length){let t=new Uint32Array(Math.min(e.segmentMarks.length,Math.max(1,c*2)));t.set(e.visibleSegmentIds),e.visibleSegmentIds=t}e.visibleSegmentIds[c]=i,c+=1}}e.visibleSegmentCount=c}function Ol(e,t,n,r,i){for(let a=0;a<e.length;a+=3){let o=e[a],s=e[a+1];if(o*(o>=0?r:t)+s*(s>=0?i:n)+e[a+2]<0)return!1}return!0}function kl(e,t,n){let r=t*4,i=Math.max(0,e.styles[r]??0);if((Math.floor(e.primitiveMeta[r+3]/bc+1e-6)&yc)===0){n.minX=e.primitiveBounds[r]-i,n.minY=e.primitiveBounds[r+1]-i,n.maxX=e.primitiveBounds[r+2]+i,n.maxY=e.primitiveBounds[r+3]+i;return}n.minX=Math.max(e.primitiveBounds[r],Math.min(e.endpoints[r],e.endpoints[r+2],e.primitiveMeta[r])-i),n.minY=Math.max(e.primitiveBounds[r+1],Math.min(e.endpoints[r+1],e.endpoints[r+3],e.primitiveMeta[r+1])-i),n.maxX=Math.min(e.primitiveBounds[r+2],Math.max(e.endpoints[r],e.endpoints[r+2],e.primitiveMeta[r])+i),n.maxY=Math.min(e.primitiveBounds[r+3],Math.max(e.endpoints[r+1],e.endpoints[r+3],e.primitiveMeta[r+1])+i),(n.minX>n.maxX||n.minY>n.maxY)&&(n.minX=n.minY=1/0,n.maxX=n.maxY=-1/0)}function Al(e,t,n,r,i){let a={c0:0,c1:0,r0:0,r1:0};return jl(e,t,n,r,i,a)?a:null}function jl(e,t,n,r,i,a){return n<i.minX||e>i.maxX||r<i.minY||t>i.maxY?!1:(a.c0=Ml(i.xEdges,e),a.c1=Nl(i.xEdges,n),a.r0=Ml(i.yEdges,t),a.r1=Nl(i.yEdges,r),!0)}function Ml(e,t){let n=e.length-2;if(t<=e[0])return 0;if(t>=e[e.length-1])return n;let r=0,i=e.length-1;for(;r+1<i;){let n=r+i>>1;e[n]<=t?r=n:i=n}return H(r,0,n)}function Nl(e,t){return Ml(e,t)}function Pl(e,t){let n=e-t;return n>=0?n:-n*Vc}function Fl(e){let t=Vs(e);if(!t)return!1;for(let e=1;e<t.length;e++)if(t[e]<t[e-1])return!1;return!0}function Il(e,t){let n=t*4,r=e.endpoints[n],i=e.endpoints[n+1],a=e.endpoints[n+2],o=e.endpoints[n+3],s=e.primitiveMeta[n],c=e.primitiveMeta[n+1],l=e.primitiveMeta[n+2],u=e.primitiveMeta[n+3],d=Math.max(0,Math.trunc(u/bc+1e-6)),f=nu(u-d*bc);if(!Number.isFinite(r)||!Number.isFinite(i)||!Number.isFinite(s)||!Number.isFinite(c))return null;let p;if((d&yc)!==0){let t=e.primitiveBounds[n],r=e.primitiveBounds[n+1],i=e.primitiveBounds[n+2],a=e.primitiveBounds[n+3];Number.isFinite(t)&&Number.isFinite(r)&&Number.isFinite(i)&&Number.isFinite(a)&&(p={minX:t,minY:r,maxX:i,maxY:a})}return{paintOrder:zs(e,t),paintGroup:Vs(e)?.[t],x0:r,y0:i,cx:a,cy:o,x1:s,y1:c,primitiveType:l,halfWidth:Math.max(0,e.styles[n]??0),flags:d,alpha:f,colorR:nu(e.styles[n+1]??0),colorG:nu(e.styles[n+2]??0),colorB:nu(e.styles[n+3]??0),visibleBounds:p}}function Ll(e,t,n,r,i=0){let a=t.x0===t.x1&&t.y0===t.y1;if(t.primitiveType!==gc||t.alpha!==1||!(t.halfWidth>0)||(t.flags&_c)!==0||a&&(t.flags&vc)===0)return!1;let o=r*qc,s=Math.floor(t.x0/o),c=Math.floor(t.y0/o);if(Math.floor(t.x1/o)!==s||Math.floor(t.y1/o)!==c)return!1;let l=t.x1<t.x0||t.x1===t.x0&&t.y1<t.y0,u=a?0:Math.round(Math.atan2(l?t.y0-t.y1:t.y1-t.y0,Math.abs(t.x1-t.x0))/xc),d=t.visibleBounds,f=e.key;f[0]=t.paintGroup??-1,f[1]=s,f[2]=c,f[3]=+!!a,f[4]=u,f[5]=t.flags,f[6]=t.halfWidth,f[7]=t.colorR,f[8]=t.colorG,f[9]=t.colorB,f[10]=+!!d,f[11]=d?d.minX:0,f[12]=d?d.minY:0,f[13]=d?d.maxX:0,f[14]=d?d.maxY:0;let p=e.find();if(!p){if(i+e.size>=Yc)return!1;p=Rl(),e.add(p)}return zl(p,t,n),!0}function Rl(){return{members:[],count:0,coincident:!0,x0:0,y0:0,x1:0,y1:0}}function zl(e,t,n){let r=t.x0,i=t.y0,a=t.x1,o=t.y1;(a<r||a===r&&o<i)&&([r,a]=[a,r],[i,o]=[o,i]),e.count>0&&(r!==e.x0/e.count||i!==e.y0/e.count||a!==e.x1/e.count||o!==e.y1/e.count)&&(e.coincident=!1),e.members.push(n),e.count++,e.x0+=r,e.y0+=i,e.x1+=a,e.y1+=o}function Bl(e,t,n,r,i,a=0){if(t.coincident?t.count<2:t.count<Jc||a>=8){for(let i of t.members)Gl(n,r,Il(e,i),i);return}if(!t.coincident&&t.count>Jc){let o=new Map,s=i*.5;for(let i of t.members){let t=Il(e,i),a=Math.floor(t.x0/s),c=Math.floor(t.y0/s);if(Math.floor(t.x1/s)!==a||Math.floor(t.y1/s)!==c){Gl(n,r,t,i);continue}let l=`${a},${c}`,u=o.get(l);u||o.set(l,u=Rl()),zl(u,t,i)}for(let t of o.values())Bl(e,t,n,r,s,a+1);return}let o=Il(e,t.members[0]);o.x0=t.x0/t.count,o.y0=t.y0/t.count,o.x1=o.cx=t.x1/t.count,o.y1=o.cy=t.y1/t.count;let s=Il(e,t.members[0]);if((s.x0!==s.x1||s.y0!==s.y1)&&Math.fround(o.x0)===Math.fround(o.x1)&&Math.fround(o.y0)===Math.fround(o.y1)){for(let i of t.members)Gl(n,r,Il(e,i),i);return}for(let e=t.count;e>0;){let t=Math.min(e,Xc);o.primitiveType=1-t,Gl(n,r,o,-1),e-=t}}function Vl(e,t){let n=e.primitiveType>=.5,r=n?e.cx:e.x1,i=n?e.cy:e.y1;return Math.max(Math.max(e.x0,r,e.x1)-Math.min(e.x0,r,e.x1),Math.max(e.y0,i,e.y1)-Math.min(e.y0,i,e.y1))+e.halfWidth*2<=t*Gc}function Hl(e,t){let n=Math.max(Math.max(e.x0,e.cx,e.x1)-Math.min(e.x0,e.cx,e.x1),Math.max(e.y0,e.cy,e.y1)-Math.min(e.y0,e.cy,e.y1));return n<=t*Gc&&(n>0||(e.flags&vc)!==0)}function Ul(e,t,n,r){let i=e.intervals.length>>1;if(i<=0)return;e.offsetWeightSum>0&&(e.offset=e.offsetSum/e.offsetWeightSum);let a=e.intervals,o=new Uint32Array(i);for(let e=0;e<i;e+=1)o[e]=e*2;o.sort((e,t)=>a[e]-a[t]||a[e+1]-a[t+1]);let s=r*Kc,c=a[o[0]],l=a[o[0]+1];for(let r=1;r<o.length;r+=1){let i=a[o[r]],u=a[o[r]+1];if(i<=l+s){l=Math.max(l,u);continue}Wl(e,t,n,c,l),c=i,l=u}Wl(e,t,n,c,l)}function Wl(e,t,n,r,i){if(i<=r)return;let a=(e.flags&yc)!==0&&e.clipMinX<=e.clipMaxX&&e.clipMinY<=e.clipMaxY;Gl(t,n,{paintOrder:e.paintOrder,paintGroup:e.paintGroup,x0:e.axisX*r+e.normalX*e.offset,y0:e.axisY*r+e.normalY*e.offset,cx:e.axisX*i+e.normalX*e.offset,cy:e.axisY*i+e.normalY*e.offset,x1:e.axisX*i+e.normalX*e.offset,y1:e.axisY*i+e.normalY*e.offset,primitiveType:gc,halfWidth:e.halfWidth,flags:e.flags,alpha:e.alpha,colorR:e.colorR,colorG:e.colorG,colorB:e.colorB,visibleBounds:a?{minX:e.clipMinX,minY:e.clipMinY,maxX:e.clipMaxX,maxY:e.clipMaxY}:void 0},-1)}function Gl(e,t,n,r){let i=n.visibleBounds,a=i?i.minX:Math.min(n.x0,n.cx,n.x1),o=i?i.minY:Math.min(n.y0,n.cy,n.y1),s=i?i.maxX:Math.max(n.x0,n.cx,n.x1),c=i?i.maxY:Math.max(n.y0,n.cy,n.y1);e.push(n,a,o,s,c,r),t.minX=Math.min(t.minX,a),t.minY=Math.min(t.minY,o),t.maxX=Math.max(t.maxX,s),t.maxY=Math.max(t.maxY,c)}function Kl(e){let t=e.visibleBounds;return t?(t.minX+t.maxX)*.5:(e.x0+e.x1)*.5}function ql(e){let t=e.visibleBounds;return t?(t.minY+t.maxY)*.5:(e.y0+e.y1)*.5}function Jl(e,t){let n=Math.max(1e-6,e.maxX-e.minX),r=Math.max(1e-6,e.maxY-e.minY),i=Math.max(n,r),a=Math.max(96,t*Zc),o=H(Math.ceil(i/a),16,96),s=n/r,c=s>=1?o:Math.max(1,Math.ceil(o*s)),l=s>=1?Math.max(1,Math.ceil(o/s)):o;return{columns:c,rows:l,tileWidth:n/c,tileHeight:r/l}}function Yl(e,t,n,r){let i=H(Math.floor((e-n.minX)/r.tileWidth),0,r.columns-1);return H(Math.floor((t-n.minY)/r.tileHeight),0,r.rows-1)*r.columns+i}function Xl(){return{minX:1/0,minY:1/0,maxX:-1/0,maxY:-1/0}}function Zl(e,t){return Number.isFinite(e.minX)&&Number.isFinite(e.minY)&&Number.isFinite(e.maxX)&&Number.isFinite(e.maxY)?e:t}function Ql(e){return Number.isFinite(e)&&e>1e-8?e:1}function $l(e){return e<=0?`exact`:`tol-${String(e).replace(`.`,`_`)}`}function eu(){return typeof performance<`u`&&typeof performance.now==`function`?performance.now():Date.now()}function tu(e,t,n){let r=n.map(e=>`${$l(e.tolerance)}:${e.segmentCount}`).join(`, `);console.info(`[hepr] vector stroke LOD generated in ${e.toFixed(1)}ms (source segments: ${Math.max(0,t|0)}, levels: ${r})`)}function nu(e){return!Number.isFinite(e)||e<=0?0:e>=1?1:e}function ru(e,t,n){return e<t?t:e>n?n:e}function H(e,t,n){return e<t?t:e>n?n:e}var iu=new WeakMap,au=new WeakMap,ou=new WeakMap;function su(e){return iu.has(e)}function cu(e){let t=iu.get(e);if(t)return t;let n=ou.get(e)?.deref(),r=n?.levels[0]?.store?.literals;return!n||!r?null:lu(n.tileGrid,r,n.levels)}function lu(e,t,n){return{tileGrid:e,literals:{segmentCount:t.segmentCount,endpoints:t.endpoints,primitiveMeta:t.primitiveMeta,primitiveBounds:t.primitiveBounds,styles:t.styles},origins:Ls(t),levels:n.map(e=>({tolerance:e.tolerance,overview:e.overview,segmentCount:e.segmentCount,records:e.records,sceneBounds:e.sceneBounds,maxHalfWidth:e.maxHalfWidth,tileOffsets:e.tileOffsets,tileCounts:e.tileCounts,tileSegmentIds:e.tileSegmentIds}))}}function uu(e,t){iu.set(e,t)}function du(e,t){let n={...e,...t.literals};Is(n,t.origins);let r={canonical:e,literals:n},i=au.get(t);if(!i){let e=tl(ol(r,0,1));i={bounds:e,allLevelBounds:tl(fu(e,t.levels))},au.set(t,i)}let a=i.bounds;return{tileGrid:t.tileGrid,elapsedMs:0,allLevelBounds:i.allLevelBounds,levels:t.levels.map(e=>new al(r,e,e,a))}}function*fu(e,t,n=.99){let r={minX:1/0,minY:1/0,maxX:-1/0,maxY:-1/0};for(let i of t)for(let t=0;t<i.segmentCount;t++){let a=i.records?i.records[t]:t;r.minX=Math.min(r.minX,e.minX[a]),r.minY=Math.min(r.minY,e.minY[a]),r.maxX=Math.max(r.maxX,e.maxX[a]),r.maxY=Math.max(r.maxY,e.maxY[a]),t&8191||(yield{value:n,message:`Finalizing Vector LOD bounds`,yieldable:!0})}return r}async function pu(e,t,n){n?.throwIfAborted();let r=new yl({yieldIntervalMs:50,shouldCancel:()=>n?.aborted??!1});await r.maybeYield(!0,0,`Restoring Vector LOD indexes`);let i={...e,...t.literals};Is(i,t.origins);let a=await nl(ol({canonical:e,literals:i},0,.2),r),o=[],s=67108864;for(let e=0;e<t.levels.length;e++){let n=t.levels[e],i=await nl(sl(n.records,n.segmentCount,a,t.tileGrid,.2+.8*e/t.levels.length,.2+.8*(e+1)/t.levels.length,s),r);s-=i.tileSegmentIds.length,o.push({...n,...i})}let c=await nl(fu(a,o,1),r);n?.throwIfAborted();let l={...t,levels:o};return au.set(l,{bounds:a,allLevelBounds:c}),l}var mu={MoveTo:0,LineTo:1,QuadraticTo:2,CubicTo:3,Close:4},hu={Butt:0,Round:1,Square:2},gu={Miter:0,Round:1,Bevel:2},_u={SolidColor:0,Gradient:1,Pattern:2},U={Rgba8:0,Gray8:1,GrayAlpha8:2,Rgba16:3,Jpeg:4,Jpeg2000:5,Jbig2:6,Ccitt:7};function vu(e){return e===U.Gray8?1:e===U.GrayAlpha8?2:e===U.Rgba8?4:e===U.Rgba16?8:0}function yu(e,t,n,r,i){if(t===U.Gray8||t===U.GrayAlpha8){let a=t===U.GrayAlpha8?2:1,o=n*r;if(!Number.isSafeInteger(o)||e.length!==o*a)return null;let s=new Uint8Array(o*4);for(let t=0;t<o;t+=1){t&16383||i?.throwIfAborted();let n=e[t*a],r=t*4;s[r]=n,s[r+1]=n,s[r+2]=n,s[r+3]=a===2?e[t*a+1]:255}return s}return t!==U.Rgba8||e.length!==n*r*4?null:e}var bu={Triangles:0,TensorPatch:1,CoonsPatch:2},xu={Axial:0,Radial:1,Function:2,FreeFormMesh:3,LatticeMesh:4,CoonsPatchMesh:5,TensorPatchMesh:6},Su={ColoredTiling:0,UncoloredTiling:1,Shading:2},Cu={NoZoom:1,NoRotate:2},wu={DeviceGray:0,DeviceRgb:1,DeviceCmyk:2,CalGray:3,CalRgb:4,Lab:5,IccBased:6,Indexed:7,Separation:8,DeviceN:9},Tu={Sampled:0,Exponential:2,Stitching:3,Calculator:4},Eu={TrueType:0,OpenType:1,Cff:2,Cff2:3,Type1:4,Type3:5},Du={Vertical:1,Invisible:2,Type3:4,ClipOnly:8},Ou={Closed:1,Rectangle:2},ku={Hairline:1,StrokeAdjust:2},Au=`Annot`;function ju(){return{transforms:{values:new Float32Array([1,0,0,1,0,0])},paths:{pathVerbOffsets:new Uint32Array([0]),verbs:new Uint8Array,verbCoordinateOffsets:new Uint32Array([0]),coordinates:new Float32Array,bounds:new Float32Array,flags:new Uint8Array,fillPathMetaA:new Float32Array,fillPathMetaB:new Float32Array,fillPathMetaC:new Float32Array,fillSegmentsA:new Float32Array,fillSegmentsB:new Float32Array},strokes:{endpoints:new Float32Array,primitiveMeta:new Float32Array,primitiveBounds:new Float32Array,styles:new Float32Array,lineWidths:new Float32Array,miterLimits:new Float32Array,lineCaps:new Uint8Array,lineJoins:new Uint8Array,flags:new Uint8Array,dashOffsets:new Uint32Array([0]),dashValues:new Float32Array,dashPhases:new Float32Array},glyphs:{fontIndices:new Uint32Array,characterCodes:new Uint32Array,glyphIds:new Uint32Array,transformIndices:new Uint32Array,advances:new Float32Array,flags:new Uint8Array},fonts:{names:[],kinds:new Uint8Array,unitsPerEm:new Uint32Array,ascents:new Float32Array,descents:new Float32Array,glyphOffsets:new Uint32Array([0]),glyphIds:new Uint32Array,outlinePathStarts:new Uint32Array,outlinePathCounts:new Uint32Array,type3ProgramIndices:new Int32Array},images:{widths:new Uint32Array,heights:new Uint32Array,bitsPerComponent:new Uint8Array,formats:new Uint8Array,colorSpaceIndices:new Int32Array,interpolate:new Uint8Array,imageMask:new Uint8Array,softMaskImageIndices:new Int32Array,colorKeyMaskOffsets:new Uint32Array([0]),colorKeyMaskValues:new Int32Array,decodeOffsets:new Uint32Array([0]),decodeValues:new Float32Array,matteOffsets:new Uint32Array([0]),matteValues:new Float32Array,dataOffsets:new Uint32Array([0]),data:new Uint8Array},meshes:{kinds:new Uint8Array,vertexOffsets:new Uint32Array([0]),indexOffsets:new Uint32Array([0]),positions:new Float32Array,colors:new Float32Array,indices:new Uint32Array,colorSpaceIndices:new Int32Array},functions:{kinds:new Uint8Array,domainOffsets:new Uint32Array([0]),domains:new Float32Array,rangeOffsets:new Uint32Array([0]),ranges:new Float32Array,parameterOffsets:new Uint32Array([0]),parameters:new Float32Array,sampleOffsets:new Uint32Array([0]),samples:new Float32Array,calculatorOffsets:new Uint32Array([0]),calculatorBytecode:new Uint8Array},gradients:{kinds:new Uint8Array,colorSpaceIndices:new Int32Array,functionIndices:new Int32Array,coordinateOffsets:new Uint32Array([0]),coordinates:new Float32Array,stopOffsets:new Uint32Array([0]),stopPositions:new Float32Array,stopPaintIndices:new Uint32Array,meshIndices:new Int32Array,extendFlags:new Uint8Array},patterns:{kinds:new Uint8Array,paintTypes:new Uint8Array,tilingTypes:new Uint8Array,bounds:new Float32Array,xSteps:new Float32Array,ySteps:new Float32Array,matrixIndices:new Uint32Array,programIndices:new Int32Array,gradientIndices:new Int32Array,underlyingColorSpaceIndices:new Int32Array},clips:{parentIndices:new Int32Array,firstPaths:new Uint32Array,pathCounts:new Uint32Array,firstGlyphs:new Uint32Array,glyphCounts:new Uint32Array,fillRules:new Uint8Array,transformIndices:new Uint32Array},colors:{spaceKinds:new Uint8Array,componentCounts:new Uint8Array,alternateSpaceIndices:new Int32Array,functionIndices:new Int32Array,parameterOffsets:new Uint32Array([0]),parameters:new Float32Array,nameOffsets:new Uint32Array([0]),names:[],profileOffsets:new Uint32Array([0]),profiles:new Uint8Array,lookupOffsets:new Uint32Array([0]),lookupBytes:new Uint8Array,iccModes:new Uint8Array,iccTransformOffsets:new Uint32Array([0]),iccTransformSamples:new Uint8Array},paints:{kinds:new Uint8Array,resourceIndices:new Uint32Array,alphas:new Float32Array,overprint:new Uint8Array,overprintModes:new Uint8Array,patternTransformIndices:new Int32Array,patternBasePaintIndices:new Int32Array},optionalContent:{names:[],defaultVisible:new Uint8Array},markedContent:{tags:[],propertyNames:[],mcids:new Int32Array,parentIndices:new Int32Array}}}function Mu(){return{rootGroupIndex:0,groups:[{commands:[],isolated:!0,knockout:!1,blendMode:`Normal`,alpha:1,alphaIsShape:!1,softMaskGroupIndex:-1,softMaskSubtype:null,softMaskTransferFunctionIndex:-1,backdropPaintIndex:-1,blendingColorSpaceIndex:-1,clipIndex:-1}],programs:[]}}var W={InvalidShape:`hepr.invalid-shape`,IncompatibleVersion:`hepr.incompatible-version`,InvalidNumber:`hepr.invalid-number`,InvalidCardinality:`hepr.invalid-cardinality`,InvalidOffsets:`hepr.invalid-offsets`,InvalidReference:`hepr.invalid-reference`,ResourceCycle:`hepr.resource-cycle`,ResourceLimit:`hepr.resource-limit`,DuplicatePage:`hepr.duplicate-page`},Nu=class extends Error{code;path;constructor(e,t,n){super(`${t}: ${n}`),this.name=`HeprDataValidationError`,this.code=e,this.path=t}},Pu=Object.freeze({maxPages:1e6,maxCommandsPerPage:1e7,maxResourcesPerStore:1e7,maxTypedArrayBytesPerPage:2147483648,maxTextCodeUnitsPerPage:1e8});function G(e,t,n){throw new Nu(e,t,n)}function Fu(e){return typeof e==`object`&&!!e&&!Array.isArray(e)}function K(e,t){Fu(e)||G(W.InvalidShape,t,`expected an object`)}function q(e,t,n){let r=Object.keys(e).sort(),i=[...t].sort();(r.length!==i.length||r.some((e,t)=>e!==i[t]))&&G(W.InvalidShape,n,`contains unknown or missing page-native fields`)}function Iu(e,t,n,r){let i=Object.keys(e),a=new Set([...t,...n]);(t.some(t=>!Object.prototype.hasOwnProperty.call(e,t))||i.some(e=>!a.has(e)))&&G(W.InvalidShape,r,`contains unknown or missing page-native fields`)}function J(e,t,n){e instanceof t||G(W.InvalidShape,n,`expected ${t.name}`)}function Lu(e,t,n=0){(!Number.isSafeInteger(e)||e<n)&&G(W.InvalidNumber,t,`expected a safe integer >= ${n}`)}function Ru(e,t){Number.isFinite(e)||G(W.InvalidNumber,t,`expected a finite number`)}function Y(e,t){for(let n=0;n<e.length;n+=1)Number.isFinite(e[n])||G(W.InvalidNumber,`${t}[${n}]`,`expected a finite number`)}function X(e,t,n){e!==t&&G(W.InvalidCardinality,n,`expected length ${t}, received ${e}`)}function zu(e,t,n){e%t!==0&&G(W.InvalidCardinality,n,`length ${e} is not divisible by ${t}`)}function Z(e,t,n,r){X(e.length,t+1,r),e[0]!==0&&G(W.InvalidOffsets,`${r}[0]`,`must be zero`);for(let t=1;t<e.length;t+=1)e[t]<e[t-1]&&G(W.InvalidOffsets,`${r}[${t}]`,`must be monotonic`);e[e.length-1]!==n&&G(W.InvalidOffsets,`${r}[${e.length-1}]`,`must equal payload length ${n}`)}function Q(e,t,n){(!Number.isSafeInteger(e)||e<-1||e>=t)&&G(W.InvalidReference,n,`expected -1 or an index below ${t}, received ${e}`)}function Bu(e,t,n){(!Number.isSafeInteger(e)||e<0||e>=t)&&G(W.InvalidReference,n,`expected an index below ${t}, received ${e}`)}function Vu(e,t,n,r){Lu(e,`${r}.first`),Lu(t,`${r}.count`,1),e+t>n&&G(W.InvalidReference,r,`range [${e}, ${e+t}) exceeds store length ${n}`)}function Hu(e,t){(!Array.isArray(e)||e.length!==4)&&G(W.InvalidShape,t,`expected a four-number tuple`),e.forEach((e,n)=>Ru(e,`${t}[${n}]`)),(e[0]>e[2]||e[1]>e[3])&&G(W.InvalidNumber,t,`rectangle is not normalized`)}function Uu(e,t){K(e,t),q(e,[`sourcePageIndex`,`mediaBox`,`cropBox`,`bleedBox`,`trimBox`,`artBox`,`rotation`,`userUnit`,`width`,`height`],t),Lu(e.sourcePageIndex,`${t}.sourcePageIndex`),Hu(e.mediaBox,`${t}.mediaBox`),Hu(e.cropBox,`${t}.cropBox`),e.bleedBox!==null&&Hu(e.bleedBox,`${t}.bleedBox`),e.trimBox!==null&&Hu(e.trimBox,`${t}.trimBox`),e.artBox!==null&&Hu(e.artBox,`${t}.artBox`),e.rotation!==0&&e.rotation!==90&&e.rotation!==180&&e.rotation!==270&&G(W.InvalidNumber,`${t}.rotation`,`expected 0, 90, 180, or 270`),Ru(e.userUnit,`${t}.userUnit`),Ru(e.width,`${t}.width`),Ru(e.height,`${t}.height`),(e.userUnit<=0||e.width<=0||e.height<=0)&&G(W.InvalidNumber,t,`userUnit, width, and height must be positive`)}function Wu(e,t){Array.isArray(e)||G(W.InvalidShape,t,`expected an array`),e.forEach((e,n)=>{let r=`${t}[${n}]`;K(e,r),Iu(e,[`code`,`severity`,`message`],[`offset`,`objectNumber`,`pageIndex`,`details`],r),(typeof e.code!=`string`||e.code.length===0)&&G(W.InvalidShape,`${r}.code`,`expected a code`),e.severity!==`info`&&e.severity!==`warning`&&e.severity!==`error`&&G(W.InvalidShape,`${r}.severity`,`expected info, warning, or error`),typeof e.message!=`string`&&G(W.InvalidShape,`${r}.message`,`expected a string`);for(let t of[`offset`,`objectNumber`,`pageIndex`]){let n=e[t];n!==void 0&&(typeof n!=`number`||!Number.isSafeInteger(n)||n<0)&&G(W.InvalidNumber,`${r}.${t}`,`expected a nonnegative safe integer`)}if(e.details!==void 0){K(e.details,`${r}.details`);for(let[t,n]of Object.entries(e.details))n!==null&&typeof n!=`string`&&typeof n!=`number`&&typeof n!=`boolean`&&G(W.InvalidShape,`${r}.details.${t}`,`expected a string, number, boolean, or null`),typeof n==`number`&&!Number.isFinite(n)&&G(W.InvalidNumber,`${r}.details.${t}`,`expected a finite number`)}})}function Gu(e,t,n){e>t.maxResourcesPerStore&&G(W.ResourceLimit,n,`${e} resources exceed limit ${t.maxResourcesPerStore}`)}function Ku(e,t,n){K(e,n),q(e,[`transforms`,`paths`,`strokes`,`glyphs`,`fonts`,`images`,`meshes`,`functions`,`gradients`,`patterns`,`clips`,`colors`,`paints`,`optionalContent`,`markedContent`],n);let r=e.transforms;K(r,`${n}.transforms`),q(r,[`values`],`${n}.transforms`),J(r.values,Float32Array,`${n}.transforms.values`),zu(r.values.length,6,`${n}.transforms.values`),Y(r.values,`${n}.transforms.values`);let i=r.values.length/6;i===0&&G(W.InvalidCardinality,`${n}.transforms.values`,`at least the identity transform is required`);let a=e.paths;K(a,`${n}.paths`),q(a,[`pathVerbOffsets`,`verbs`,`verbCoordinateOffsets`,`coordinates`,`bounds`,`flags`,`fillPathMetaA`,`fillPathMetaB`,`fillPathMetaC`,`fillSegmentsA`,`fillSegmentsB`],`${n}.paths`),J(a.pathVerbOffsets,Uint32Array,`${n}.paths.pathVerbOffsets`),J(a.verbs,Uint8Array,`${n}.paths.verbs`),J(a.verbCoordinateOffsets,Uint32Array,`${n}.paths.verbCoordinateOffsets`),J(a.coordinates,Float32Array,`${n}.paths.coordinates`),J(a.bounds,Float32Array,`${n}.paths.bounds`),J(a.flags,Uint8Array,`${n}.paths.flags`);let o=Math.max(0,a.pathVerbOffsets.length-1);Z(a.pathVerbOffsets,o,a.verbs.length,`${n}.paths.pathVerbOffsets`),Z(a.verbCoordinateOffsets,a.verbs.length,a.coordinates.length,`${n}.paths.verbCoordinateOffsets`),X(a.bounds.length,o*4,`${n}.paths.bounds`),X(a.flags.length,o,`${n}.paths.flags`),Y(a.coordinates,`${n}.paths.coordinates`),Y(a.bounds,`${n}.paths.bounds`);for(let e=0;e<o;e+=1){let t=e*4;(a.bounds[t+2]<a.bounds[t]||a.bounds[t+3]<a.bounds[t+1])&&G(W.InvalidNumber,`${n}.paths.bounds[${t}]`,`inverted path bounds`),(a.flags[e]&~(Ou.Closed|Ou.Rectangle))!==0&&G(W.InvalidNumber,`${n}.paths.flags[${e}]`,`unknown path flag`)}let s=[2,2,4,6,0];for(let e=0;e<a.verbs.length;e+=1){let t=a.verbs[e];t>mu.Close&&G(W.InvalidNumber,`${n}.paths.verbs[${e}]`,`unknown verb`),a.verbCoordinateOffsets[e+1]-a.verbCoordinateOffsets[e]!==s[t]&&G(W.InvalidCardinality,`${n}.paths.verbCoordinateOffsets[${e}]`,`verb ${t} requires ${s[t]} coordinates`)}J(a.fillPathMetaA,Float32Array,`${n}.paths.fillPathMetaA`),J(a.fillPathMetaB,Float32Array,`${n}.paths.fillPathMetaB`),J(a.fillPathMetaC,Float32Array,`${n}.paths.fillPathMetaC`),J(a.fillSegmentsA,Float32Array,`${n}.paths.fillSegmentsA`),J(a.fillSegmentsB,Float32Array,`${n}.paths.fillSegmentsB`),zu(a.fillPathMetaA.length,4,`${n}.paths.fillPathMetaA`),X(a.fillPathMetaB.length,a.fillPathMetaA.length,`${n}.paths.fillPathMetaB`),X(a.fillPathMetaC.length,a.fillPathMetaA.length,`${n}.paths.fillPathMetaC`),zu(a.fillSegmentsA.length,4,`${n}.paths.fillSegmentsA`),X(a.fillSegmentsB.length,a.fillSegmentsA.length,`${n}.paths.fillSegmentsB`),Y(a.fillPathMetaA,`${n}.paths.fillPathMetaA`),Y(a.fillPathMetaB,`${n}.paths.fillPathMetaB`),Y(a.fillPathMetaC,`${n}.paths.fillPathMetaC`),Y(a.fillSegmentsA,`${n}.paths.fillSegmentsA`),Y(a.fillSegmentsB,`${n}.paths.fillSegmentsB`);let c=a.fillPathMetaA.length/4,l=e.strokes;K(l,`${n}.strokes`),q(l,[`endpoints`,`primitiveMeta`,`primitiveBounds`,`styles`,`lineWidths`,`miterLimits`,`lineCaps`,`lineJoins`,`flags`,`dashOffsets`,`dashValues`,`dashPhases`],`${n}.strokes`);for(let[e,t]of[[`endpoints`,l.endpoints],[`primitiveMeta`,l.primitiveMeta],[`primitiveBounds`,l.primitiveBounds],[`styles`,l.styles]])J(t,Float32Array,`${n}.strokes.${e}`),zu(t.length,4,`${n}.strokes.${e}`),Y(t,`${n}.strokes.${e}`);X(l.primitiveMeta.length,l.endpoints.length,`${n}.strokes.primitiveMeta`),X(l.primitiveBounds.length,l.endpoints.length,`${n}.strokes.primitiveBounds`),X(l.styles.length,l.endpoints.length,`${n}.strokes.styles`);let u=l.endpoints.length/4;for(let[e,t,r]of[[`lineWidths`,l.lineWidths,Float32Array],[`miterLimits`,l.miterLimits,Float32Array],[`lineCaps`,l.lineCaps,Uint8Array],[`lineJoins`,l.lineJoins,Uint8Array],[`flags`,l.flags,Uint8Array],[`dashPhases`,l.dashPhases,Float32Array]])J(t,r,`${n}.strokes.${e}`);let d=l.lineWidths.length;X(l.miterLimits.length,d,`${n}.strokes.miterLimits`),X(l.lineCaps.length,d,`${n}.strokes.lineCaps`),X(l.lineJoins.length,d,`${n}.strokes.lineJoins`),X(l.flags.length,d,`${n}.strokes.flags`),X(l.dashPhases.length,d,`${n}.strokes.dashPhases`),J(l.dashOffsets,Uint32Array,`${n}.strokes.dashOffsets`),J(l.dashValues,Float32Array,`${n}.strokes.dashValues`),Z(l.dashOffsets,d,l.dashValues.length,`${n}.strokes.dashOffsets`),Y(l.lineWidths,`${n}.strokes.lineWidths`),Y(l.miterLimits,`${n}.strokes.miterLimits`),Y(l.dashValues,`${n}.strokes.dashValues`),Y(l.dashPhases,`${n}.strokes.dashPhases`);for(let e=0;e<d;e+=1){l.lineWidths[e]<0&&G(W.InvalidNumber,`${n}.strokes.lineWidths[${e}]`,`negative line width`),l.miterLimits[e]<1&&G(W.InvalidNumber,`${n}.strokes.miterLimits[${e}]`,`miter limit below one`),(l.lineCaps[e]>2||l.lineJoins[e]>2)&&G(W.InvalidNumber,`${n}.strokes.lineCaps[${e}]`,`unknown cap or join`),(l.flags[e]&~(ku.Hairline|ku.StrokeAdjust))!==0&&G(W.InvalidNumber,`${n}.strokes.flags[${e}]`,`unknown stroke flag`),(l.flags[e]&ku.Hairline)!==0!=(l.lineWidths[e]===0)&&G(W.InvalidNumber,`${n}.strokes.flags[${e}]`,`hairline flag and width disagree`);let t=l.dashOffsets[e],r=l.dashOffsets[e+1],i=0;for(let e=t;e<r;e+=1)l.dashValues[e]<0&&G(W.InvalidNumber,`${n}.strokes.dashValues[${e}]`,`negative dash length`),i+=l.dashValues[e];r>t&&i===0&&G(W.InvalidNumber,`${n}.strokes.dashOffsets[${e}]`,`all-zero dash array`)}let f=e.glyphs;K(f,`${n}.glyphs`),q(f,[`fontIndices`,`characterCodes`,`glyphIds`,`transformIndices`,`advances`,`flags`],`${n}.glyphs`),J(f.fontIndices,Uint32Array,`${n}.glyphs.fontIndices`);let p=f.fontIndices.length;for(let[e,t,r,i]of[[`characterCodes`,f.characterCodes,Uint32Array,1],[`glyphIds`,f.glyphIds,Uint32Array,1],[`transformIndices`,f.transformIndices,Uint32Array,1],[`advances`,f.advances,Float32Array,2],[`flags`,f.flags,Uint8Array,1]])J(t,r,`${n}.glyphs.${e}`),X(t.length,p*i,`${n}.glyphs.${e}`);Y(f.advances,`${n}.glyphs.advances`);let m=e.fonts;K(m,`${n}.fonts`),q(m,[`names`,`kinds`,`unitsPerEm`,`ascents`,`descents`,`glyphOffsets`,`glyphIds`,`outlinePathStarts`,`outlinePathCounts`,`type3ProgramIndices`],`${n}.fonts`),(!Array.isArray(m.names)||m.names.some(e=>typeof e!=`string`))&&G(W.InvalidShape,`${n}.fonts.names`,`expected strings`),J(m.kinds,Uint8Array,`${n}.fonts.kinds`);let h=m.names.length;for(let[e,t,r]of[[`kinds`,m.kinds,Uint8Array],[`unitsPerEm`,m.unitsPerEm,Uint32Array],[`ascents`,m.ascents,Float32Array],[`descents`,m.descents,Float32Array]])J(t,r,`${n}.fonts.${e}`),X(t.length,h,`${n}.fonts.${e}`);J(m.glyphOffsets,Uint32Array,`${n}.fonts.glyphOffsets`),J(m.glyphIds,Uint32Array,`${n}.fonts.glyphIds`),Z(m.glyphOffsets,h,m.glyphIds.length,`${n}.fonts.glyphOffsets`);for(let[e,t,r]of[[`outlinePathStarts`,m.outlinePathStarts,Uint32Array],[`outlinePathCounts`,m.outlinePathCounts,Uint32Array],[`type3ProgramIndices`,m.type3ProgramIndices,Int32Array]])J(t,r,`${n}.fonts.${e}`),X(t.length,m.glyphIds.length,`${n}.fonts.${e}`);Y(m.ascents,`${n}.fonts.ascents`),Y(m.descents,`${n}.fonts.descents`);for(let e=0;e<h;e+=1)m.kinds[e]>Eu.Type3&&G(W.InvalidNumber,`${n}.fonts.kinds[${e}]`,`unknown font kind`),m.unitsPerEm[e]===0&&G(W.InvalidNumber,`${n}.fonts.unitsPerEm[${e}]`,`font units-per-em must be positive`);for(let e=0;e<p;e+=1){let t=f.fontIndices[e];Bu(t,h,`${n}.glyphs.fontIndices[${e}]`),Bu(f.transformIndices[e],i,`${n}.glyphs.transformIndices[${e}]`);let r=Du.Invisible|Du.ClipOnly|Du.Vertical|Du.Type3;(f.flags[e]&~r)!==0&&G(W.InvalidNumber,`${n}.glyphs.flags[${e}]`,`unknown glyph flag`);let a=(f.flags[e]&Du.Type3)!==0;a!==(m.kinds[t]===Eu.Type3)&&G(W.InvalidReference,`${n}.glyphs.flags[${e}]`,`Type3 glyph flag and font kind disagree`);let o=m.glyphOffsets[t],s=m.glyphOffsets[t+1],c=f.glyphIds[e],l=o,u=s;for(;l<u;){let e=l+(u-l>>1);m.glyphIds[e]<c?l=e+1:u=e}(l>=s||m.glyphIds[l]!==c)&&G(W.InvalidReference,`${n}.glyphs.glyphIds[${e}]`,`glyph instance has no self-contained font record`);let d=(f.flags[e]&Du.Invisible)!==0;a&&!d&&m.type3ProgramIndices[l]<0&&G(W.InvalidReference,`${n}.fonts.type3ProgramIndices[${l}]`,`visible Type3 glyph has no self-contained CharProc program`)}for(let e=0;e<m.glyphIds.length;e+=1)m.outlinePathStarts[e]+m.outlinePathCounts[e]>o&&G(W.InvalidReference,`${n}.fonts.outlinePathStarts[${e}]`,`outline path span exceeds the path store`);for(let e=0;e<h;e+=1){let t=m.glyphOffsets[e],r=m.glyphOffsets[e+1],i=m.kinds[e]===Eu.Type3;for(let e=t+1;e<r;e+=1)m.glyphIds[e-1]>=m.glyphIds[e]&&G(W.InvalidNumber,`${n}.fonts.glyphIds[${e}]`,`font glyph identifiers must be strictly increasing`);for(let e=t;e<r;e+=1)!i&&m.type3ProgramIndices[e]>=0&&G(W.InvalidReference,`${n}.fonts.type3ProgramIndices[${e}]`,`ordinary outline glyph references a Type3 program`),i&&m.outlinePathCounts[e]!==0&&G(W.InvalidReference,`${n}.fonts.outlinePathCounts[${e}]`,`Type3 glyph paint must be retained as a reusable program`)}let g=e.images;K(g,`${n}.images`),q(g,[`widths`,`heights`,`bitsPerComponent`,`formats`,`colorSpaceIndices`,`interpolate`,`imageMask`,`softMaskImageIndices`,`colorKeyMaskOffsets`,`colorKeyMaskValues`,`decodeOffsets`,`decodeValues`,`matteOffsets`,`matteValues`,`dataOffsets`,`data`],`${n}.images`),J(g.widths,Uint32Array,`${n}.images.widths`);let _=g.widths.length;for(let[e,t,r]of[[`heights`,g.heights,Uint32Array],[`bitsPerComponent`,g.bitsPerComponent,Uint8Array],[`formats`,g.formats,Uint8Array],[`colorSpaceIndices`,g.colorSpaceIndices,Int32Array],[`interpolate`,g.interpolate,Uint8Array],[`imageMask`,g.imageMask,Uint8Array],[`softMaskImageIndices`,g.softMaskImageIndices,Int32Array]])J(t,r,`${n}.images.${e}`),X(t.length,_,`${n}.images.${e}`);J(g.colorKeyMaskOffsets,Uint32Array,`${n}.images.colorKeyMaskOffsets`),J(g.colorKeyMaskValues,Int32Array,`${n}.images.colorKeyMaskValues`),J(g.decodeOffsets,Uint32Array,`${n}.images.decodeOffsets`),J(g.decodeValues,Float32Array,`${n}.images.decodeValues`),J(g.matteOffsets,Uint32Array,`${n}.images.matteOffsets`),J(g.matteValues,Float32Array,`${n}.images.matteValues`),J(g.dataOffsets,Uint32Array,`${n}.images.dataOffsets`),J(g.data,Uint8Array,`${n}.images.data`),Z(g.colorKeyMaskOffsets,_,g.colorKeyMaskValues.length,`${n}.images.colorKeyMaskOffsets`),Z(g.decodeOffsets,_,g.decodeValues.length,`${n}.images.decodeOffsets`),Z(g.matteOffsets,_,g.matteValues.length,`${n}.images.matteOffsets`),Z(g.dataOffsets,_,g.data.length,`${n}.images.dataOffsets`),Y(g.decodeValues,`${n}.images.decodeValues`),Y(g.matteValues,`${n}.images.matteValues`);for(let e=0;e<_;e+=1){(g.widths[e]===0||g.heights[e]===0)&&G(W.InvalidNumber,`${n}.images[${e}]`,`dimensions must be positive`),g.formats[e]>U.Ccitt&&G(W.InvalidNumber,`${n}.images.formats[${e}]`,`unknown format`);let t=g.bitsPerComponent[e];![1,2,4,8,16].includes(t)&&(t!==0||g.formats[e]!==U.Jpeg2000)&&G(W.InvalidNumber,`${n}.images.bitsPerComponent[${e}]`,`unsupported image component precision`),(g.interpolate[e]>1||g.imageMask[e]>1)&&G(W.InvalidNumber,`${n}.images[${e}]`,`image flags must be zero or one`),Q(g.softMaskImageIndices[e],_,`${n}.images.softMaskImageIndices[${e}]`);let r=g.dataOffsets[e+1]-g.dataOffsets[e],i=g.formats[e]===U.Gray8?1:g.formats[e]===U.GrayAlpha8?2:g.formats[e]===U.Rgba8?4:g.formats[e]===U.Rgba16?8:0;if(i!==0){let t=g.widths[e]*g.heights[e]*i;(!Number.isSafeInteger(t)||r!==t)&&G(W.InvalidCardinality,`${n}.images.dataOffsets[${e}]`,`raw image payload must contain exactly ${t} bytes`)}else r===0&&G(W.InvalidCardinality,`${n}.images.dataOffsets[${e}]`,`encoded image payload must not be empty`)}qu(g.softMaskImageIndices,`${n}.images.softMaskImageIndices`);let v=e.meshes;K(v,`${n}.meshes`),q(v,[`kinds`,`vertexOffsets`,`indexOffsets`,`positions`,`colors`,`indices`,`colorSpaceIndices`],`${n}.meshes`),J(v.kinds,Uint8Array,`${n}.meshes.kinds`);let y=v.kinds.length;J(v.vertexOffsets,Uint32Array,`${n}.meshes.vertexOffsets`),J(v.indexOffsets,Uint32Array,`${n}.meshes.indexOffsets`),J(v.positions,Float32Array,`${n}.meshes.positions`),J(v.colors,Float32Array,`${n}.meshes.colors`),J(v.indices,Uint32Array,`${n}.meshes.indices`),J(v.colorSpaceIndices,Int32Array,`${n}.meshes.colorSpaceIndices`),zu(v.positions.length,2,`${n}.meshes.positions`);let b=v.positions.length/2;X(v.colors.length,b*4,`${n}.meshes.colors`),Z(v.vertexOffsets,y,b,`${n}.meshes.vertexOffsets`),Z(v.indexOffsets,y,v.indices.length,`${n}.meshes.indexOffsets`),X(v.colorSpaceIndices.length,y,`${n}.meshes.colorSpaceIndices`),Y(v.positions,`${n}.meshes.positions`),Y(v.colors,`${n}.meshes.colors`);for(let e=0;e<y;e+=1){let t=v.kinds[e],r=v.vertexOffsets[e],i=v.vertexOffsets[e+1],a=v.indexOffsets[e],o=v.indexOffsets[e+1],s=i-r,c=o-a;for(let e=a;e<o;e+=1)(v.indices[e]<r||v.indices[e]>=i)&&G(W.InvalidReference,`${n}.meshes.indices[${e}]`,`vertex index is outside its mesh`);if(t===bu.Triangles){zu(c,3,`${n}.meshes.indices[${e}]`);continue}let l=t===bu.CoonsPatch?12:t===bu.TensorPatch?16:0;l===0&&G(W.InvalidNumber,`${n}.meshes.kinds[${e}]`,`unknown mesh kind`),s===0&&G(W.InvalidCardinality,`${n}.meshes.vertexOffsets[${e}]`,`a patch mesh must contain at least one complete patch`),zu(s,l,`${n}.meshes.vertexOffsets[${e}]`),X(c,s,`${n}.meshes.indexOffsets[${e}]`);for(let e=0;e<c;e+=1){let t=a+e;v.indices[t]!==r+e&&G(W.InvalidReference,`${n}.meshes.indices[${t}]`,`patch controls must retain source order`);let i=e%l;if(i===0||i===3||i===6||i===9)continue;let o=(r+e)*4;(v.colors[o]!==0||v.colors[o+1]!==0||v.colors[o+2]!==0||v.colors[o+3]!==0)&&G(W.InvalidNumber,`${n}.meshes.colors[${o}]`,`non-corner patch controls must have zero color payloads`)}}let x=e.functions;K(x,`${n}.functions`),q(x,[`kinds`,`domainOffsets`,`domains`,`rangeOffsets`,`ranges`,`parameterOffsets`,`parameters`,`sampleOffsets`,`samples`,`calculatorOffsets`,`calculatorBytecode`],`${n}.functions`),J(x.kinds,Uint8Array,`${n}.functions.kinds`);let S=x.kinds.length;for(let[e,t,r,i]of[[`domainOffsets`,`domains`,x.domains,Float32Array],[`rangeOffsets`,`ranges`,x.ranges,Float32Array],[`parameterOffsets`,`parameters`,x.parameters,Float32Array],[`sampleOffsets`,`samples`,x.samples,Float32Array],[`calculatorOffsets`,`calculatorBytecode`,x.calculatorBytecode,Uint8Array]]){let a=x[e];J(a,Uint32Array,`${n}.functions.${e}`),J(r,i,`${n}.functions.${t}`),Z(a,S,r.length,`${n}.functions.${e}`),r instanceof Float32Array&&Y(r,`${n}.functions.${t}`)}for(let e=0;e<S;e+=1){let t=x.kinds[e];t!==Tu.Sampled&&t!==Tu.Exponential&&t!==Tu.Stitching&&t!==Tu.Calculator&&G(W.InvalidNumber,`${n}.functions.kinds[${e}]`,`unknown PDF function kind`)}let C=e.gradients;K(C,`${n}.gradients`),q(C,[`kinds`,`colorSpaceIndices`,`functionIndices`,`coordinateOffsets`,`coordinates`,`stopOffsets`,`stopPositions`,`stopPaintIndices`,`meshIndices`,`extendFlags`],`${n}.gradients`),J(C.kinds,Uint8Array,`${n}.gradients.kinds`);let w=C.kinds.length;for(let[e,t,r]of[[`colorSpaceIndices`,C.colorSpaceIndices,Int32Array],[`functionIndices`,C.functionIndices,Int32Array],[`meshIndices`,C.meshIndices,Int32Array],[`extendFlags`,C.extendFlags,Uint8Array]])J(t,r,`${n}.gradients.${e}`),X(t.length,w,`${n}.gradients.${e}`);J(C.coordinateOffsets,Uint32Array,`${n}.gradients.coordinateOffsets`),J(C.coordinates,Float32Array,`${n}.gradients.coordinates`),J(C.stopOffsets,Uint32Array,`${n}.gradients.stopOffsets`),J(C.stopPositions,Float32Array,`${n}.gradients.stopPositions`),J(C.stopPaintIndices,Uint32Array,`${n}.gradients.stopPaintIndices`),Z(C.coordinateOffsets,w,C.coordinates.length,`${n}.gradients.coordinateOffsets`),Z(C.stopOffsets,w,C.stopPositions.length,`${n}.gradients.stopOffsets`),X(C.stopPaintIndices.length,C.stopPositions.length,`${n}.gradients.stopPaintIndices`),Y(C.coordinates,`${n}.gradients.coordinates`),Y(C.stopPositions,`${n}.gradients.stopPositions`);let T=e.patterns;K(T,`${n}.patterns`),q(T,[`kinds`,`paintTypes`,`tilingTypes`,`bounds`,`xSteps`,`ySteps`,`matrixIndices`,`programIndices`,`gradientIndices`,`underlyingColorSpaceIndices`],`${n}.patterns`),J(T.kinds,Uint8Array,`${n}.patterns.kinds`);let E=T.kinds.length;for(let[e,t,r,i]of[[`paintTypes`,T.paintTypes,Uint8Array,1],[`tilingTypes`,T.tilingTypes,Uint8Array,1],[`bounds`,T.bounds,Float32Array,4],[`xSteps`,T.xSteps,Float32Array,1],[`ySteps`,T.ySteps,Float32Array,1],[`matrixIndices`,T.matrixIndices,Uint32Array,1],[`programIndices`,T.programIndices,Int32Array,1],[`gradientIndices`,T.gradientIndices,Int32Array,1],[`underlyingColorSpaceIndices`,T.underlyingColorSpaceIndices,Int32Array,1]])J(t,r,`${n}.patterns.${e}`),X(t.length,E*i,`${n}.patterns.${e}`);Y(T.bounds,`${n}.patterns.bounds`),Y(T.xSteps,`${n}.patterns.xSteps`),Y(T.ySteps,`${n}.patterns.ySteps`);for(let e=0;e<E;e+=1){Bu(T.matrixIndices[e],i,`${n}.patterns.matrixIndices[${e}]`);let t=T.kinds[e];t!==Su.ColoredTiling&&t!==Su.UncoloredTiling&&t!==Su.Shading&&G(W.InvalidNumber,`${n}.patterns.kinds[${e}]`,`unknown pattern kind`),(t===Su.ColoredTiling&&T.paintTypes[e]!==1||t===Su.UncoloredTiling&&T.paintTypes[e]!==2)&&G(W.InvalidNumber,`${n}.patterns.paintTypes[${e}]`,`tiling-pattern kind and PaintType disagree`)}let D=e.clips;K(D,`${n}.clips`),q(D,[`parentIndices`,`firstPaths`,`pathCounts`,`firstGlyphs`,`glyphCounts`,`fillRules`,`transformIndices`],`${n}.clips`),J(D.parentIndices,Int32Array,`${n}.clips.parentIndices`);let O=D.parentIndices.length;for(let[e,t,r]of[[`firstPaths`,D.firstPaths,Uint32Array],[`pathCounts`,D.pathCounts,Uint32Array],[`firstGlyphs`,D.firstGlyphs,Uint32Array],[`glyphCounts`,D.glyphCounts,Uint32Array],[`fillRules`,D.fillRules,Uint8Array],[`transformIndices`,D.transformIndices,Uint32Array]])J(t,r,`${n}.clips.${e}`),X(t.length,O,`${n}.clips.${e}`);let k=new Uint8Array(p);for(let e=0;e<O;e+=1){Q(D.parentIndices[e],O,`${n}.clips.parentIndices[${e}]`),D.parentIndices[e]>=e&&G(W.InvalidReference,`${n}.clips.parentIndices[${e}]`,`persistent clip parent must precede its child`),D.firstPaths[e]+D.pathCounts[e]>o&&G(W.InvalidReference,`${n}.clips.firstPaths[${e}]`,`path span is out of range`),D.firstGlyphs[e]+D.glyphCounts[e]>p&&G(W.InvalidReference,`${n}.clips.firstGlyphs[${e}]`,`glyph span is out of range`);let t=D.pathCounts[e]>0,r=D.glyphCounts[e]>0;if(t&&r&&G(W.InvalidReference,`${n}.clips.pathCounts[${e}]`,`clip node cannot mix path and glyph unions`),r&&D.fillRules[e]!==0&&G(W.InvalidNumber,`${n}.clips.fillRules[${e}]`,`glyph clipping unions use the nonzero fill rule`),r){let t=D.firstGlyphs[e],r=t+D.glyphCounts[e];for(let i=t;i<r;i+=1){let t=f.flags[i];(t&Du.ClipOnly)===0&&G(W.InvalidReference,`${n}.clips.firstGlyphs[${e}]`,`text clip references a glyph without the clipping flag`),(t&Du.Type3)!==0&&G(W.InvalidReference,`${n}.clips.firstGlyphs[${e}]`,`Type3 glyph clipping has no exact outline contract`),k[i]!==0&&G(W.InvalidReference,`${n}.clips.firstGlyphs[${e}]`,`clipping glyph is referenced by more than one text clip`),k[i]=1;let r=f.fontIndices[i],a=f.glyphIds[i],o=m.glyphOffsets[r],s=m.glyphOffsets[r+1],c=o,l=s;for(;c<l;){let e=c+(l-c>>1);m.glyphIds[e]<a?c=e+1:l=e}(c>=s||m.glyphIds[c]!==a)&&G(W.InvalidReference,`${n}.clips.firstGlyphs[${e}]`,`clipping glyph has no font-outline record`)}}Bu(D.transformIndices[e],i,`${n}.clips.transformIndices[${e}]`),D.fillRules[e]>1&&G(W.InvalidNumber,`${n}.clips.fillRules[${e}]`,`unknown fill rule`)}for(let e=0;e<p;e+=1)(f.flags[e]&Du.ClipOnly)!==0!=(k[e]!==0)&&G(W.InvalidReference,`${n}.glyphs.flags[${e}]`,`clipping glyph must belong to exactly one persistent text clip`);qu(D.parentIndices,`${n}.clips.parentIndices`);let A=e.colors;K(A,`${n}.colors`),q(A,[`spaceKinds`,`componentCounts`,`alternateSpaceIndices`,`functionIndices`,`parameterOffsets`,`parameters`,`nameOffsets`,`names`,`profileOffsets`,`profiles`,`lookupOffsets`,`lookupBytes`,`iccModes`,`iccTransformOffsets`,`iccTransformSamples`],`${n}.colors`),J(A.spaceKinds,Uint8Array,`${n}.colors.spaceKinds`);let j=A.spaceKinds.length;for(let[e,t,r]of[[`componentCounts`,A.componentCounts,Uint8Array],[`alternateSpaceIndices`,A.alternateSpaceIndices,Int32Array],[`functionIndices`,A.functionIndices,Int32Array],[`iccModes`,A.iccModes,Uint8Array]])J(t,r,`${n}.colors.${e}`),X(t.length,j,`${n}.colors.${e}`);(!Array.isArray(A.names)||A.names.some(e=>typeof e!=`string`))&&G(W.InvalidShape,`${n}.colors.names`,`expected strings`);for(let[e,t,r,i]of[[`parameterOffsets`,`parameters`,A.parameters,Float32Array],[`profileOffsets`,`profiles`,A.profiles,Uint8Array],[`lookupOffsets`,`lookupBytes`,A.lookupBytes,Uint8Array],[`iccTransformOffsets`,`iccTransformSamples`,A.iccTransformSamples,Uint8Array]]){let a=A[e];J(a,Uint32Array,`${n}.colors.${e}`),J(r,i,`${n}.colors.${t}`),Z(a,j,r.length,`${n}.colors.${e}`)}J(A.nameOffsets,Uint32Array,`${n}.colors.nameOffsets`),Z(A.nameOffsets,j,A.names.length,`${n}.colors.nameOffsets`),Y(A.parameters,`${n}.colors.parameters`);let M=e.paints;K(M,`${n}.paints`),q(M,[`kinds`,`resourceIndices`,`alphas`,`overprint`,`overprintModes`,`patternTransformIndices`,`patternBasePaintIndices`],`${n}.paints`),J(M.kinds,Uint8Array,`${n}.paints.kinds`);let N=M.kinds.length;for(let[e,t,r]of[[`resourceIndices`,M.resourceIndices,Uint32Array],[`alphas`,M.alphas,Float32Array],[`overprint`,M.overprint,Uint8Array],[`overprintModes`,M.overprintModes,Uint8Array],[`patternTransformIndices`,M.patternTransformIndices,Int32Array],[`patternBasePaintIndices`,M.patternBasePaintIndices,Int32Array]])J(t,r,`${n}.paints.${e}`),X(t.length,N,`${n}.paints.${e}`);Y(M.alphas,`${n}.paints.alphas`);let P=e.optionalContent;K(P,`${n}.optionalContent`),q(P,[`names`,`defaultVisible`],`${n}.optionalContent`),(!Array.isArray(P.names)||P.names.some(e=>typeof e!=`string`))&&G(W.InvalidShape,`${n}.optionalContent.names`,`expected strings`),J(P.defaultVisible,Uint8Array,`${n}.optionalContent.defaultVisible`);let F=P.names.length;X(P.defaultVisible.length,F,`${n}.optionalContent.defaultVisible`);for(let e=0;e<F;e+=1)P.defaultVisible[e]>1&&G(W.InvalidNumber,`${n}.optionalContent.defaultVisible[${e}]`,`expected zero or one`);let I=e.markedContent;K(I,`${n}.markedContent`),q(I,[`tags`,`propertyNames`,`mcids`,`parentIndices`],`${n}.markedContent`),(!Array.isArray(I.tags)||I.tags.some(e=>typeof e!=`string`))&&G(W.InvalidShape,`${n}.markedContent.tags`,`expected strings`);let L=I.tags.length;(!Array.isArray(I.propertyNames)||I.propertyNames.some(e=>e!==null&&typeof e!=`string`))&&G(W.InvalidShape,`${n}.markedContent.propertyNames`,`expected strings or null`),X(I.propertyNames.length,L,`${n}.markedContent.propertyNames`),J(I.mcids,Int32Array,`${n}.markedContent.mcids`),J(I.parentIndices,Int32Array,`${n}.markedContent.parentIndices`),X(I.mcids.length,L,`${n}.markedContent.mcids`),X(I.parentIndices.length,L,`${n}.markedContent.parentIndices`);for(let e=0;e<L;e+=1)Q(I.parentIndices[e],L,`${n}.markedContent.parentIndices[${e}]`);qu(I.parentIndices,`${n}.markedContent.parentIndices`);let R={transforms:i,paths:o,fillPaths:c,strokeSegments:u,strokeStyles:d,glyphs:p,fonts:h,images:_,meshes:y,functions:S,gradients:w,patterns:E,clips:O,colors:j,paints:N,optionalContent:F,markedContent:L};for(let[e,r]of Object.entries(R))Gu(r,t,`${n}.${e}`);for(let e=0;e<j;e+=1){let t=A.spaceKinds[e];(t>wu.DeviceN||A.componentCounts[e]===0)&&G(W.InvalidNumber,`${n}.colors.spaceKinds[${e}]`,`unknown or zero-component color space`);let r=t===wu.DeviceGray||t===wu.CalGray||t===wu.Indexed||t===wu.Separation?1:t===wu.DeviceRgb||t===wu.CalRgb||t===wu.Lab?3:t===wu.DeviceCmyk?4:0;r!==0&&A.componentCounts[e]!==r&&G(W.InvalidCardinality,`${n}.colors.componentCounts[${e}]`,`color space requires ${r} components`);let i=A.iccModes[e],a=A.iccTransformOffsets[e+1]-A.iccTransformOffsets[e],o=A.componentCounts[e],s=t===wu.IccBased,c=o===1?256:o===3?33:o===4?17:0;if((i>4||!s&&i!==0||s&&c===0||i===4&&o!==3||a!==(i>=2?3*c**o:0))&&G(W.InvalidCardinality,`${n}.colors.iccModes[${e}]`,`ICC mode and transform lattice must match the color space`),s){let t=A.parameterOffsets[e];A.parameterOffsets[e+1]-t!==2*o&&G(W.InvalidCardinality,`${n}.colors.parameters`,`ICC Range must have two bounds per component`);for(let e=0;e<o;e+=1)A.parameters[t+e*2]>A.parameters[t+e*2+1]&&G(W.InvalidNumber,`${n}.colors.parameters`,`ICC Range is reversed`);i===1&&(A.alternateSpaceIndices[e]<0||A.componentCounts[A.alternateSpaceIndices[e]]!==o)&&G(W.InvalidReference,`${n}.colors.alternateSpaceIndices[${e}]`,`ICC fallback requires a compatible alternate color space`)}Q(A.alternateSpaceIndices[e],j,`${n}.colors.alternateSpaceIndices[${e}]`),Q(A.functionIndices[e],S,`${n}.colors.functionIndices[${e}]`)}qu(A.alternateSpaceIndices,`${n}.colors.alternateSpaceIndices`);for(let e=0;e<_;e+=1)Q(g.colorSpaceIndices[e],j,`${n}.images.colorSpaceIndices[${e}]`),g.imageMask[e]===0?g.colorSpaceIndices[e]<0&&g.formats[e]!==U.Jpeg2000&&g.formats[e]!==U.Gray8&&g.formats[e]!==U.GrayAlpha8&&g.formats[e]!==U.Rgba8&&g.formats[e]!==U.Rgba16&&G(W.InvalidReference,`${n}.images.colorSpaceIndices[${e}]`,`encoded image has no self-contained PDF color space`):(g.colorSpaceIndices[e]>=0||g.formats[e]!==U.Gray8)&&G(W.InvalidReference,`${n}.images[${e}]`,`stencil image must use self-contained Gray8 coverage without a color space`);for(let e=0;e<y;e+=1)Bu(v.colorSpaceIndices[e],j,`${n}.meshes.colorSpaceIndices[${e}]`);for(let e=0;e<C.stopPaintIndices.length;e+=1)Bu(C.stopPaintIndices[e],N,`${n}.gradients.stopPaintIndices[${e}]`);for(let e=0;e<E;e+=1)Q(T.underlyingColorSpaceIndices[e],j,`${n}.patterns.underlyingColorSpaceIndices[${e}]`);for(let e=0;e<w;e+=1){Q(C.colorSpaceIndices[e],j,`${n}.gradients.colorSpaceIndices[${e}]`),Q(C.functionIndices[e],S,`${n}.gradients.functionIndices[${e}]`),Q(C.meshIndices[e],y,`${n}.gradients.meshIndices[${e}]`);let t=C.kinds[e],r=t===xu.FreeFormMesh||t===xu.LatticeMesh?bu.Triangles:t===xu.CoonsPatchMesh?bu.CoonsPatch:t===xu.TensorPatchMesh?bu.TensorPatch:-1,i=t===xu.Axial||t===xu.Radial||t===xu.Function;r<0&&!i&&G(W.InvalidNumber,`${n}.gradients.kinds[${e}]`,`unknown gradient kind`);let a=C.meshIndices[e];r>=0?(Bu(a,y,`${n}.gradients.meshIndices[${e}]`),v.kinds[a]!==r&&G(W.InvalidReference,`${n}.gradients.meshIndices[${e}]`,`gradient and mesh kinds disagree`),v.colorSpaceIndices[a]!==C.colorSpaceIndices[e]&&G(W.InvalidReference,`${n}.gradients.colorSpaceIndices[${e}]`,`gradient and mesh color spaces disagree`)):a>=0&&G(W.InvalidReference,`${n}.gradients.meshIndices[${e}]`,`a non-mesh gradient must not reference a mesh`)}for(let e=0;e<N;e+=1){let t=M.kinds[e],r=t===_u.SolidColor?j:t===_u.Gradient?w:t===_u.Pattern?E:-1;if(r<0&&G(W.InvalidNumber,`${n}.paints.kinds[${e}]`,`unknown paint kind`),Bu(M.resourceIndices[e],r,`${n}.paints.resourceIndices[${e}]`),Q(M.patternTransformIndices[e],i,`${n}.paints.patternTransformIndices[${e}]`),Q(M.patternBasePaintIndices[e],N,`${n}.paints.patternBasePaintIndices[${e}]`),t===_u.Pattern){M.patternTransformIndices[e]<0&&G(W.InvalidReference,`${n}.paints.patternTransformIndices[${e}]`,`pattern paint requires its use-time transform`);let t=T.kinds[M.resourceIndices[e]],r=M.resourceIndices[e],i=M.patternBasePaintIndices[e];t===Su.UncoloredTiling?(i<0||i>=e||M.kinds[i]!==_u.SolidColor||M.alphas[i]!==1||M.overprint[i]!==0||M.overprintModes[i]!==0)&&G(W.InvalidReference,`${n}.paints.patternBasePaintIndices[${e}]`,`uncolored tiling pattern requires a preceding opaque solid base-color paint`):i>=0&&G(W.InvalidReference,`${n}.paints.patternBasePaintIndices[${e}]`,`colored or shading pattern must not carry a base-color binding`),t===Su.Shading?(T.gradientIndices[r]<0&&G(W.InvalidReference,`${n}.patterns.gradientIndices[${r}]`,`a used shading pattern requires a gradient resource`),T.programIndices[r]>=0&&G(W.InvalidReference,`${n}.patterns.programIndices[${r}]`,`a shading pattern must not reference a tiling-cell program`)):(T.programIndices[r]<0&&G(W.InvalidReference,`${n}.patterns.programIndices[${r}]`,`a used tiling pattern requires a reusable cell program`),T.gradientIndices[r]>=0&&G(W.InvalidReference,`${n}.patterns.gradientIndices[${r}]`,`a tiling pattern must not reference a shading gradient`))}else(M.patternTransformIndices[e]>=0||M.patternBasePaintIndices[e]>=0)&&G(W.InvalidReference,`${n}.paints[${e}]`,`non-pattern paint carries pattern-only metadata`);(M.alphas[e]<0||M.alphas[e]>1)&&G(W.InvalidNumber,`${n}.paints.alphas[${e}]`,`alpha must be in [0, 1]`),M.overprint[e]>1&&G(W.InvalidNumber,`${n}.paints.overprint[${e}]`,`expected 0 or 1`),M.overprintModes[e]>1&&G(W.InvalidNumber,`${n}.paints.overprintModes[${e}]`,`expected PDF overprint mode 0 or 1`)}return R}function qu(e,t){let n=new Uint8Array(e.length);for(let r=0;r<e.length;r+=1){if(n[r]!==0)continue;let i=r;for(;i>=0&&n[i]===0;)n[i]=1,i=e[i];for(i>=0&&n[i]===1&&G(W.ResourceCycle,`${t}[${i}]`,`cycle detected`),i=r;i>=0&&n[i]===1;)n[i]=2,i=e[i]}}function Ju(e,t,n){Bu(e.transformIndex,t.transforms,`${n}.transformIndex`),Q(e.clipIndex,t.clips,`${n}.clipIndex`),Q(e.optionalContentIndex,t.optionalContent,`${n}.optionalContentIndex`),Q(e.markedContentIndex,t.markedContent,`${n}.markedContentIndex`),(!Number.isSafeInteger(e.sourceOffset)||e.sourceOffset<-1)&&G(W.InvalidNumber,`${n}.sourceOffset`,`expected -1 or a safe integer`),(!Number.isSafeInteger(e.sourceLength)||e.sourceLength<-1)&&G(W.InvalidNumber,`${n}.sourceLength`,`expected -1 or a safe integer`)}function Yu(e,t,n,r,i,a,o,s=!1){K(e,o);let c=[`kind`,`transformIndex`,`clipIndex`,`optionalContentIndex`,`markedContentIndex`,`sourceOffset`,`sourceLength`];if(e.kind===`invoke-group`)q(e,[...c,`groupIndex`],o);else if(e.kind===`invoke-program`)q(e,[...c,`programIndex`,`type3PaintIndex`,`viewTransformFlags`],o);else if(e.kind===`draw`){let t=[...c,`source`,`first`,`count`];e.source===`paths`?Iu(e,[...t,`fillPaintIndex`,`strokePaintIndex`,`strokeStyleIndex`,`fillRule`],[`fillPaintInherited`,`strokePaintInherited`],o):e.source===`fill-paths`||e.source===`stroke-segments`?q(e,[...t,`paintIndex`],o):e.source===`glyphs`?Iu(e,[...t,`fillPaintIndex`,`strokePaintIndex`,`strokeStyleIndex`,`renderingMode`],[`strokeTransformIndex`],o):e.source===`images`?q(e,[...t,`paintIndex`],o):(e.source===`meshes`||e.source===`gradients`||e.source===`patterns`)&&q(e,t,o)}else G(W.InvalidShape,`${o}.kind`,`unknown command kind`);if(Ju(e,t,o),e.kind===`invoke-group`){Bu(e.groupIndex,i,`${o}.groupIndex`);return}if(e.kind===`invoke-program`){Bu(e.programIndex,a,`${o}.programIndex`),Q(e.type3PaintIndex,t.paints,`${o}.type3PaintIndex`),(!Number.isSafeInteger(e.viewTransformFlags)||e.viewTransformFlags<0||(e.viewTransformFlags&~(Cu.NoZoom|Cu.NoRotate))!==0)&&G(W.InvalidNumber,`${o}.viewTransformFlags`,`unknown view-transform flag`);return}let l=e.source===`paths`?t.paths:e.source===`fill-paths`?t.fillPaths:e.source===`stroke-segments`?t.strokeSegments:e.source===`glyphs`?t.glyphs:e.source===`images`?t.images:e.source===`meshes`?t.meshes:e.source===`gradients`?t.gradients:e.source===`patterns`?t.patterns:-1;if(l<0&&G(W.InvalidShape,`${o}.source`,`unknown draw source`),Vu(e.first,e.count,l,o),e.source===`fill-paths`||e.source===`stroke-segments`)Q(e.paintIndex,t.paints,`${o}.paintIndex`),e.paintIndex<0&&!s&&G(W.InvalidReference,`${o}.paintIndex`,`inherited paint requires an uncolored reusable program`);else if(e.source===`paths`){Q(e.fillPaintIndex,t.paints,`${o}.fillPaintIndex`),Q(e.strokePaintIndex,t.paints,`${o}.strokePaintIndex`),Q(e.strokeStyleIndex,t.strokeStyles,`${o}.strokeStyleIndex`),(e.fillPaintInherited!==void 0&&typeof e.fillPaintInherited!=`boolean`||e.strokePaintInherited!==void 0&&typeof e.strokePaintInherited!=`boolean`)&&G(W.InvalidShape,o,`path inheritance flags must be boolean`);let n=e.fillPaintInherited===!0,r=e.strokePaintInherited===!0;(n||r)&&!s&&G(W.InvalidReference,o,`inherited path paint requires an uncolored reusable program`),(n&&e.fillPaintIndex>=0||r&&e.strokePaintIndex>=0)&&G(W.InvalidReference,o,`path paint cannot be both explicit and inherited`);let i=e.fillPaintIndex>=0||n,a=e.strokePaintIndex>=0||r;!i&&!a&&G(W.InvalidReference,o,`path run has no paint`),a&&e.strokeStyleIndex<0&&G(W.InvalidReference,`${o}.strokeStyleIndex`,`painted stroke needs a style`),!a&&e.strokeStyleIndex>=0&&G(W.InvalidReference,`${o}.strokeStyleIndex`,`fill-only path must not carry a stroke style`),e.fillRule!==0&&e.fillRule!==1&&G(W.InvalidNumber,`${o}.fillRule`,`unknown fill rule`)}else if(e.source===`glyphs`){Q(e.fillPaintIndex,t.paints,`${o}.fillPaintIndex`),Q(e.strokePaintIndex,t.paints,`${o}.strokePaintIndex`),Q(e.strokeStyleIndex,t.strokeStyles,`${o}.strokeStyleIndex`),e.strokeTransformIndex!==void 0&&Bu(e.strokeTransformIndex,t.transforms,`${o}.strokeTransformIndex`),(!Number.isInteger(e.renderingMode)||e.renderingMode<0||e.renderingMode>7)&&G(W.InvalidNumber,`${o}.renderingMode`,`expected PDF text mode 0..7`);let n=e.renderingMode===0||e.renderingMode===2||e.renderingMode===4||e.renderingMode===6,i=e.renderingMode===1||e.renderingMode===2||e.renderingMode===5||e.renderingMode===6;!i&&e.strokeTransformIndex!==void 0&&G(W.InvalidReference,`${o}.strokeTransformIndex`,`fill-only glyphs must not carry a stroke transform`);let a=e.fillPaintIndex>=0||s&&n,c=e.strokePaintIndex>=0||s&&i;a!==n&&G(W.InvalidReference,`${o}.fillPaintIndex`,`fill paint does not match the PDF text rendering mode`),c!==i&&G(W.InvalidReference,`${o}.strokePaintIndex`,`stroke paint does not match the PDF text rendering mode`),e.strokeStyleIndex>=0!==i&&G(W.InvalidReference,`${o}.strokeStyleIndex`,`stroke style does not match the PDF text rendering mode`);let l=e.renderingMode===3||e.renderingMode===7,u=e.renderingMode>=4;for(let t=e.first;t<e.first+e.count;t+=1){let e=r[t];(e&Du.Type3)!==0&&(e&Du.Invisible)===0&&G(W.InvalidReference,`${o}.first`,`visible Type3 glyph paint must use its reusable CharProc program`),(e&Du.Invisible)!==0!==l&&G(W.InvalidReference,`${o}.renderingMode`,`glyph invisibility flag does not match the PDF text rendering mode`),(e&Du.ClipOnly)!==0!==u&&G(W.InvalidReference,`${o}.renderingMode`,`glyph clipping flag does not match the PDF text rendering mode`)}}else if(e.source===`images`){Q(e.paintIndex,t.paints,`${o}.paintIndex`);for(let t=e.first;t<e.first+e.count;t+=1){let r=n[t]!==0;r&&e.paintIndex<0&&!s&&G(W.InvalidReference,`${o}.paintIndex`,`stencil image mask requires the current nonstroking paint`),!r&&e.paintIndex>=0&&G(W.InvalidReference,`${o}.paintIndex`,`ordinary image must not carry a stencil paint`)}}}function Xu(e,t,n,r){let i=e.displayProgram;K(i,r),q(i,[`rootGroupIndex`,`groups`,`programs`],r),(!Array.isArray(i.groups)||!Array.isArray(i.programs))&&G(W.InvalidShape,r,`groups and programs must be arrays`),Bu(i.rootGroupIndex,i.groups.length,`${r}.rootGroupIndex`);let a=new Set;for(let t=0;t<e.stores.patterns.kinds.length;t+=1){if(e.stores.patterns.kinds[t]!==Su.UncoloredTiling)continue;let n=e.stores.patterns.programIndices[t];n>=0&&n<i.programs.length&&a.add(n)}let{groupModes:o,programModes:s}=Zu(e,a),c=0;i.groups.forEach((n,a)=>{let s=`${r}.groups[${a}]`;K(n,s),q(n,[`commands`,`isolated`,`knockout`,`blendMode`,`alpha`,`alphaIsShape`,`softMaskGroupIndex`,`softMaskSubtype`,`softMaskTransferFunctionIndex`,`backdropPaintIndex`,`blendingColorSpaceIndex`,`clipIndex`],s);let l=n;Array.isArray(l.commands)||G(W.InvalidShape,`${s}.commands`,`expected an array`),c+=l.commands.length,l.commands.forEach((n,r)=>Yu(n,t,e.stores.images.imageMask,e.stores.glyphs.flags,i.groups.length,i.programs.length,`${s}.commands[${r}]`,o[a]===2)),(typeof l.isolated!=`boolean`||typeof l.knockout!=`boolean`||typeof l.alphaIsShape!=`boolean`)&&G(W.InvalidShape,s,`group flags must be boolean`),Ru(l.alpha,`${s}.alpha`),(l.alpha<0||l.alpha>1)&&G(W.InvalidNumber,`${s}.alpha`,`expected [0, 1]`),Qu(l.blendMode)||G(W.InvalidShape,`${s}.blendMode`,`unknown PDF blend mode`),Q(l.softMaskGroupIndex,i.groups.length,`${s}.softMaskGroupIndex`),l.softMaskSubtype!==null&&l.softMaskSubtype!==`Alpha`&&l.softMaskSubtype!==`Luminosity`&&G(W.InvalidShape,`${s}.softMaskSubtype`,`expected Alpha, Luminosity, or null`),Q(l.softMaskTransferFunctionIndex,t.functions,`${s}.softMaskTransferFunctionIndex`),l.softMaskGroupIndex<0&&(l.softMaskSubtype!==null||l.softMaskTransferFunctionIndex>=0)&&G(W.InvalidReference,s,`soft-mask metadata requires a soft-mask group`),l.softMaskGroupIndex>=0&&l.softMaskSubtype===null&&G(W.InvalidReference,`${s}.softMaskSubtype`,`a referenced soft-mask group requires Alpha or Luminosity semantics`),Q(l.backdropPaintIndex,t.paints,`${s}.backdropPaintIndex`),Q(l.blendingColorSpaceIndex,t.colors,`${s}.blendingColorSpaceIndex`),Q(l.clipIndex,t.clips,`${s}.clipIndex`)}),i.programs.forEach((n,a)=>{let o=`${r}.programs[${a}]`;K(n,o),q(n,[`kind`,`commands`,`matrixIndex`,`bounds`,`clipToBounds`,`resourceName`],o);let l=n;l.kind!==`form`&&l.kind!==`type3`&&l.kind!==`pattern`&&G(W.InvalidShape,`${o}.kind`,`expected form, type3, or pattern`),Array.isArray(l.commands)||G(W.InvalidShape,`${o}.commands`,`expected an array`),c+=l.commands.length,l.commands.forEach((n,r)=>{let c=`${o}.commands[${r}]`;Yu(n,t,e.stores.images.imageMask,e.stores.glyphs.flags,i.groups.length,i.programs.length,c,s[a]===2),n.kind===`invoke-program`&&n.type3PaintIndex>=0&&i.programs[n.programIndex]?.kind!==`type3`&&G(W.InvalidReference,`${c}.type3PaintIndex`,`inherited Type3 paint requires a Type3 target program`)}),Bu(l.matrixIndex,t.transforms,`${o}.matrixIndex`),l.bounds!==null&&Hu(l.bounds,`${o}.bounds`),typeof l.clipToBounds!=`boolean`&&G(W.InvalidShape,`${o}.clipToBounds`,`expected boolean`),l.resourceName!==null&&typeof l.resourceName!=`string`&&G(W.InvalidShape,`${o}.resourceName`,`expected string or null`)}),i.groups.forEach((e,t)=>{e.commands.forEach((e,n)=>{e.kind===`invoke-program`&&e.type3PaintIndex>=0&&i.programs[e.programIndex]?.kind!==`type3`&&G(W.InvalidReference,`${r}.groups[${t}].commands[${n}].type3PaintIndex`,`inherited Type3 paint requires a Type3 target program`)})}),c>n.maxCommandsPerPage&&G(W.ResourceLimit,r,`${c} commands exceed limit ${n.maxCommandsPerPage}`);for(let t=0;t<e.stores.fonts.type3ProgramIndices.length;t+=1){let n=e.stores.fonts.type3ProgramIndices[t];Q(n,i.programs.length,`stores.fonts.type3ProgramIndices[${t}]`),n>=0&&i.programs[n].kind!==`type3`&&G(W.InvalidReference,`stores.fonts.type3ProgramIndices[${t}]`,`Type3 glyph must reference a Type3 reusable program`)}for(let n=0;n<e.stores.patterns.programIndices.length;n+=1){Q(e.stores.patterns.programIndices[n],i.programs.length,`stores.patterns.programIndices[${n}]`);let r=e.stores.patterns.programIndices[n];r>=0&&i.programs[r].kind!==`pattern`&&G(W.InvalidReference,`stores.patterns.programIndices[${n}]`,`tiling pattern must reference a Pattern reusable program`),Q(e.stores.patterns.gradientIndices[n],t.gradients,`stores.patterns.gradientIndices[${n}]`)}$u(e,r)}function Zu(e,t){let{groups:n,programs:r,rootGroupIndex:i}=e.displayProgram,a=new Uint8Array(n.length),o=new Uint8Array(r.length),s=[],c=(e,t,n)=>{let r=e===`group`?a:o;!Number.isSafeInteger(t)||t<0||t>=r.length||(r[t]&n)===0&&(r[t]|=n,s.push({kind:e,index:t,mode:n}))};c(`group`,i,1);for(let e=0;e<r.length;e+=1)Fu(r[e])&&(r[e].kind===`type3`||t.has(e)?c(`program`,e,2):r[e].kind===`pattern`&&c(`program`,e,1));for(let e=0;e<s.length;e+=1){let{kind:t,index:i,mode:a}=s[e],o=t===`group`?n[i]:r[i];if(Fu(o)&&Array.isArray(o.commands)){t===`group`&&typeof o.softMaskGroupIndex==`number`&&o.softMaskGroupIndex>=0&&c(`group`,o.softMaskGroupIndex,a);for(let e of o.commands)Fu(e)&&(e.kind===`invoke-group`?c(`group`,e.groupIndex,a):e.kind===`invoke-program`&&c(`program`,e.programIndex,typeof e.type3PaintIndex==`number`&&e.type3PaintIndex>=0?2:a))}}return{groupModes:a,programModes:o}}function Qu(e){return e===`Normal`||e===`Multiply`||e===`Screen`||e===`Overlay`||e===`Darken`||e===`Lighten`||e===`ColorDodge`||e===`ColorBurn`||e===`HardLight`||e===`SoftLight`||e===`Difference`||e===`Exclusion`||e===`Hue`||e===`Saturation`||e===`Color`||e===`Luminosity`}function $u(e,t){let{groups:n,programs:r}=e.displayProgram,i=n.length,a=i+r.length,o=new Uint8Array(a),s=t=>{if(t.kind!==`draw`)return[];let n=t.source===`paths`?[t.fillPaintIndex,t.strokePaintIndex]:t.source===`fill-paths`||t.source===`stroke-segments`||t.source===`images`?[t.paintIndex]:t.source===`glyphs`?[t.fillPaintIndex,t.strokePaintIndex]:[],r=[];for(let t of n){if(t<0||e.stores.paints.kinds[t]!==_u.Pattern)continue;let n=e.stores.paints.resourceIndices[t],i=e.stores.patterns.programIndices[n];i>=0&&r.push(i)}return r},c=t=>{let a=[],o=t<i?n[t].commands:r[t-i].commands;if(t<i){let e=n[t].softMaskGroupIndex;e>=0&&a.push(e)}for(let t of o){t.kind===`invoke-group`&&a.push(t.groupIndex),t.kind===`invoke-program`&&a.push(i+t.programIndex);for(let e of s(t))a.push(i+e);if(t.kind===`draw`&&t.source===`patterns`)for(let n=t.first;n<t.first+t.count;n+=1){let t=e.stores.patterns.programIndices[n];t>=0&&a.push(i+t)}}return a},l=[];for(let e=0;e<a;e+=1)if(o[e]===0)for(o[e]=1,l.push({node:e,edges:c(e),cursor:0});l.length>0;){let e=l[l.length-1];if(e.cursor>=e.edges.length){o[e.node]=2,l.pop();continue}let n=e.edges[e.cursor++];o[n]===1&&G(W.ResourceCycle,t,`display node ${n} is cyclic`),o[n]===0&&(o[n]=1,l.push({node:n,edges:c(n),cursor:0}))}}function ed(e,t,n){let r=e.textIndex;K(r,n),q(r,[`version`,`text`,`charGlyphIndices`,`fallbackQuads`],n),r.version!==1&&G(W.IncompatibleVersion,`${n}.version`,`expected 1`),typeof r.text!=`string`&&G(W.InvalidShape,`${n}.text`,`expected a string`),r.text.length>t.maxTextCodeUnitsPerPage&&G(W.ResourceLimit,`${n}.text`,`text limit exceeded`),J(r.charGlyphIndices,Int32Array,`${n}.charGlyphIndices`),J(r.fallbackQuads,Float32Array,`${n}.fallbackQuads`),X(r.charGlyphIndices.length,r.text.length,`${n}.charGlyphIndices`),zu(r.fallbackQuads.length,4,`${n}.fallbackQuads`),Y(r.fallbackQuads,`${n}.fallbackQuads`);let i=r.fallbackQuads.length/4,a=e.stores.glyphs.glyphIds.length;for(let e=0;e<r.charGlyphIndices.length;e+=1){let t=r.charGlyphIndices[e];(t>=a||t<=-2&&-t-2>=i)&&G(W.InvalidReference,`${n}.charGlyphIndices[${e}]`,`text geometry reference is out of range`)}}function td(e){let t={...Pu,...e};for(let[e,n]of Object.entries(t))if(!Number.isSafeInteger(n)||n<=0)throw RangeError(`${e} must be a positive safe integer`);return t}function nd(e,t=new Set){return typeof e!=`object`||!e||t.has(e)?0:(t.add(e),ArrayBuffer.isView(e)?e.byteLength:Array.isArray(e)?e.reduce((e,n)=>e+nd(n,t),0):Object.values(e).reduce((e,n)=>e+nd(n,t),0))}function rd(e,t){let n=td(t);K(e,`page`),Iu(e,[`kind`,`version`,`pageInfo`,`displayProgram`,`stores`,`textIndex`,`diagnostics`],[`annotations`],`page`);let r=e;r.kind!==`hepr-page`&&G(W.InvalidShape,`page.kind`,`expected hepr-page`),r.version!==8&&G(W.IncompatibleVersion,`page.version`,`expected 8; v7 and older data must be regenerated`),Uu(r.pageInfo,`page.pageInfo`);let i=nd(r.stores);if(i>n.maxTypedArrayBytesPerPage&&G(W.ResourceLimit,`page.stores`,`${i} typed-array bytes exceed limit ${n.maxTypedArrayBytesPerPage}`),Xu(r,Ku(r.stores,n,`page.stores`),n,`page.displayProgram`),ed(r,n,`page.textIndex`),Wu(r.diagnostics,`page.diagnostics`),r.annotations!==void 0)try{gt(r.annotations,{sourcePageIndex:r.pageInfo.sourcePageIndex,conditionCount:r.stores.optionalContent.defaultVisible.length})}catch{G(W.InvalidShape,`page.annotations`,`invalid annotation metadata`)}}function id(){let e=globalThis.process;if(!e?.versions?.node)return null;if(typeof e.getBuiltinModule!=`function`)throw Error(`HEPR Node.js raster operations require Node.js 22.13 or newer.`);try{return e.getBuiltinModule(`module`).createRequire(import.meta.url)(`@napi-rs/canvas`)}catch(e){throw Error(`Unable to load the optional Node.js canvas backend. Install it with "npm install @napi-rs/canvas".`,{cause:e})}}var ad=()=>({conditions:new Set,backdrop:!1,all:!1});function $(e,t){for(let n of t.conditions)e.conditions.add(n);e.backdrop||=t.backdrop,e.all||=t.all}var od=class{page;commands=new WeakMap;resources=new Map;active=new Set;constructor(e){this.page=e}span(e,t){let n=this.page.displayProgram.groups[this.page.displayProgram.rootGroupIndex],r=ad();if(!n||e<0||t<1||e+t>n.commands.length)r.all=!0;else{for(let i=e;i<e+t;i++)$(r,this.command(n.commands[i]));if(n.softMaskGroupIndex>=0&&$(r,this.group(n.softMaskGroupIndex)),r.backdrop)for(let t=0;t<e;t++)$(r,this.command(n.commands[t]))}return r.all?Uint32Array.from({length:this.page.stores.optionalContent.defaultVisible.length},(e,t)=>t):Uint32Array.from(r.conditions)}resource(e,t){let n=this.resources.get(e);if(n)return n;let r=ad();return this.active.has(e)||this.active.size>64?(r.all=!0,r):(this.active.add(e),t(r),this.active.delete(e),this.resources.set(e,r),r)}group(e){return this.resource(`group:${e}`,t=>{let n=this.page.displayProgram.groups[e];if(!n){t.all=!0;return}t.backdrop=n.blendMode!==`Normal`||n.knockout||n.backdropPaintIndex>=0||!n.isolated,n.softMaskGroupIndex>=0&&$(t,this.group(n.softMaskGroupIndex));for(let e of n.commands)$(t,this.command(e))})}program(e){return this.resource(`program:${e}`,t=>{let n=this.page.displayProgram.programs[e];if(!n){t.all=!0;return}for(let e of n.commands)$(t,this.command(e))})}pattern(e){return this.resource(`pattern:${e}`,t=>{let n=this.page.stores.patterns.programIndices[e];n===void 0?t.all=!0:n>=0&&$(t,this.program(n))})}paint(e){return this.resource(`paint:${e}`,t=>{this.page.stores.paints.kinds[e]===_u.Pattern&&$(t,this.pattern(this.page.stores.paints.resourceIndices[e]))})}command(e){let t=this.commands.get(e);if(t)return t;let n=ad();if(e.optionalContentIndex>=0&&n.conditions.add(e.optionalContentIndex),e.kind===`invoke-group`)$(n,this.group(e.groupIndex));else if(e.kind===`invoke-program`)$(n,this.program(e.programIndex)),e.type3PaintIndex>=0&&$(n,this.paint(e.type3PaintIndex));else if(`paintIndex`in e&&e.paintIndex>=0&&$(n,this.paint(e.paintIndex)),`fillPaintIndex`in e&&(e.fillPaintIndex>=0&&$(n,this.paint(e.fillPaintIndex)),e.strokePaintIndex>=0&&$(n,this.paint(e.strokePaintIndex))),e.source===`patterns`)for(let t=e.first;t<e.first+e.count;t++)$(n,this.pattern(t));else e.source===`glyphs`&&$(n,this.resource(`glyph-programs`,e=>{for(let t of new Set(this.page.stores.fonts.type3ProgramIndices))t>=0&&$(e,this.program(t))}));return this.commands.set(e,n),n}};function sd(e,t){let n=e.page.stores.optionalContent,r=new Uint8Array(n.defaultVisible.length);if(e.optionalContentConditions.length!==r.length)throw RangeError(`Retained visibility map has an invalid length.`);for(let n=0;n<r.length;n++){let i=e.optionalContentConditions[n];if(i<-1||i>=t.conditions.length)throw RangeError(`Retained visibility map references an unknown condition.`);r[n]=+(i<0||t.conditions[i]!==0)}return{...e.page,stores:{...e.page.stores,optionalContent:{...n,defaultVisible:r}}}}var cd=class{scene;nodes=[];dependencies=[];renderSpan;layers=new Map;pageVisibility;visible=new Set;generation=0;disposed=!1;constructor(e,t){this.scene=e,this.renderSpan=t??(async(e,t,n,r)=>{let{renderNativeRetainedCommandSpan:i}=await ze(async()=>{let{renderNativeRetainedCommandSpan:e}=await import(`./retainedPageCompositor-B_XYYQ0w.js`);return{renderNativeRetainedCommandSpan:e}},[],import.meta.url);return i(e,t,n,r)});let r=e.retainedPages?.map(e=>new od(e.page))??[],i=t=>{for(let n of t)n.kind===`retained`?(this.nodes.push(n),this.layers.set(n.rasterIndex,e.rasterLayers[n.rasterIndex]),this.dependencies.push(r[n.retainedPage].span(n.firstCommand,n.count))):n.kind===`group`&&(i(n.children),n.softMask&&i(n.softMask.children))};e.paintGraph&&i(e.paintGraph.roots),this.pageVisibility=e.retainedPages?.map(e=>e.page.stores.optionalContent.defaultVisible.slice())??[],this.visible=this.visibleSlots(n(e))}getLayers(){return new Map(this.layers)}async prepare(e,t){if(this.disposed)throw Error(`Retained page replay has been disposed.`);t.signal.throwIfAborted();let n=++this.generation,r=new Map(this.layers),i=new Map,a=this.scene.retainedPages?.map(t=>sd(t,e))??[],s=a.map(e=>e.stores.optionalContent.defaultVisible),c=this.visibleSlots(e),l=e=>{if(!(n!==this.generation||this.disposed))try{t.onProgress?.(e)}catch{}};l(0);try{for(let e=0;e<this.nodes.length;e++){t.signal.throwIfAborted();let n=this.nodes[e],r=this.scene.rasterLayers[n.rasterIndex],u=s[n.retainedPage],d=this.pageVisibility[n.retainedPage],f=this.dependencies[e].some(e=>u[e]!==d[e]);if(!c.has(n.rasterIndex))this.visible.has(n.rasterIndex)&&i.set(n.rasterIndex,{...r,width:1,height:1,data:new Uint8Array(4)});else if(f||!this.visible.has(n.rasterIndex)){await o(new Promise(e=>setTimeout(e,0)),t.signal);let e=await o(this.renderSpan(a[n.retainedPage],n.firstCommand,n.count,t.signal),t.signal);if(t.signal.throwIfAborted(),e){let t=this.scene.retainedPages[n.retainedPage].matrix,a=e.matrix,o=new Float32Array([t[0]*a[0]+t[2]*a[1],t[1]*a[0]+t[3]*a[1],t[0]*a[2]+t[2]*a[3],t[1]*a[2]+t[3]*a[3],t[0]*a[4]+t[2]*a[5]+t[4],t[1]*a[4]+t[3]*a[5]+t[5]]);i.set(n.rasterIndex,{...e,matrix:o,paintOrder:r.paintOrder,pageIndex:r.pageIndex})}else i.set(n.rasterIndex,{...r,width:1,height:1,data:new Uint8Array(4)})}l(Math.floor((e+1)/this.nodes.length*100))}for(let[e,t]of i)r.set(e,t);return{layers:i,commit:()=>{if(t.signal.throwIfAborted(),this.disposed||n!==this.generation)throw new DOMException(`Retained replay superseded.`,`AbortError`);this.layers=r,this.pageVisibility=s,this.visible=c}}}finally{l(null)}}visibleSlots(e){return new Set(ta(this.scene,t=>t===void 0||e.conditions[t]!==0).filter(e=>e.kind===`retained`).map(e=>e.kind===`retained`?e.node.rasterIndex:-1))}dispose(){this.disposed=!0,this.generation++,this.layers.clear(),this.visible.clear(),this.pageVisibility=[]}};function ld({container:e,controller:t}){let n=e.ownerDocument;e.innerHTML=`<details class="pdf-layers"><summary>PDF Layers</summary>
    <fieldset>
    <label class="pdf-layers-all" title="Show or hide all available layers, including filtered-out layers. Locked layers stay unchanged; mutually exclusive layers keep their current choice."><input type="checkbox" />All</label>
    <label class="pdf-layers-filter">Filter layers<input type="search" placeholder="Layer name" aria-label="Filter PDF layers" /></label>
    <div class="pdf-layers-list"></div>
    <button type="button">Reset to PDF defaults</button>
    </fieldset>
    <div class="pdf-layers-status" role="status" aria-live="polite"></div>
    <progress max="100" hidden aria-label="Preparing PDF layers"></progress></details>`;let r=e.querySelector(`.pdf-layers-all input`),i=e.querySelector(`fieldset`),a=e.querySelector(`input[type="search"]`),o=e.querySelector(`.pdf-layers-list`),s=e.querySelector(`button`),c=e.querySelector(`.pdf-layers-status`),l=e.querySelector(`progress`),u=!1,d=0,f=0;async function p(e){let t=d;f++,c.textContent=`Applying layer visibility…`;try{await e(),!u&&t===d&&(c.textContent=``)}catch(e){!u&&t===d&&!(e instanceof DOMException&&e.name===`AbortError`)&&(c.textContent=`Layer change failed: ${e instanceof Error?e.message:String(e)}. Try again or reset to PDF defaults.`)}finally{!u&&t===d&&(f--,m())}}function m(){if(u)return;let e=t.getLayers(),i=t.getAllLayerVisibility();r.checked=i.checked,r.indeterminate=i.indeterminate,r.disabled=i.disabled;let c=new Map(e.map(e=>[e.id,e])),l=new Set,d=a.value.trim().toLocaleLowerCase();if(o.replaceChildren(),s.disabled=e.length===0,a.disabled=e.length===0,!e.length){o.textContent=`This PDF has no optional-content layers.`;return}let f=(e,r)=>{for(let i of e){let e=n.createElement(`div`);if(e.className=`pdf-layer-branch`,i.kind===`group`){let r=c.get(i.groupId);if(!r)continue;if(l.add(r.id),r.name.toLocaleLowerCase().includes(d)){let i=n.createElement(`label`);i.title=`${r.name}\n${r.id}${r.locked?`
Locked by the PDF`:``}`;let a=n.createElement(`input`);a.type=`checkbox`,a.checked=r.visible,a.disabled=r.locked||!r.usedInView,a.addEventListener(`change`,()=>{p(()=>t.setLayerVisibility(r.id,a.checked))});let o=n.createElement(`span`);o.textContent=r.name||`Unnamed layer`,i.append(a,o),e.append(i)}}else if(!d||i.label.toLocaleLowerCase().includes(d)){let t=n.createElement(`div`);t.textContent=i.label,t.className=`pdf-layer-label`,e.append(t)}if(i.children?.length){let t=n.createElement(`div`);t.className=`pdf-layer-children`,f(i.children,t),t.childNodes.length&&e.append(t)}e.childNodes.length&&r.append(e)}};f(t.getLayerOrder(),o),f(e.filter(e=>!l.has(e.id)).map(e=>({kind:`group`,groupId:e.id})),o),o.childNodes.length||(o.textContent=e.length?`No matching layers.`:`This PDF has no optional-content layers.`)}let h=()=>{p(()=>t.setAllLayerVisibility(r.checked))},g=()=>{p(()=>t.resetLayerVisibility())};r.addEventListener(`change`,h),a.addEventListener(`input`,m),s.addEventListener(`click`,g);let _=t.subscribeLayerVisibility(m);return m(),{refresh({resetFilter:e=!0}={}){u||(d++,f=0,e&&(a.value=``),c.textContent=``,l.hidden=!0,l.value=0,m())},setEnabled(e){u||(i.disabled=!e)},setProgress(e){u||(l.hidden=e===null,l.value=e??0,e===null?f||(c.textContent=``):c.textContent=`Preparing PDF layers… ${Math.round(e)}%`)},dispose(){u=!0,d++,_(),r.removeEventListener(`change`,h),a.removeEventListener(`input`,m),s.removeEventListener(`click`,g),e.replaceChildren()}}}var ud=500;function dd(e){return e.subtype!==`Popup`&&!(e.flags&35)}function fd(e){let t=`${e.subtype} · p. ${e.sourcePageIndex+1}`,n=e.destination??e.action?.destination,r=(e.contents||e.tooltip||e.subject||e.field?.name||e.action?.uri||n?.name||(n?.sourcePageIndex===void 0?void 0:`Go to page ${n.sourcePageIndex+1}`)||e.name)?.replace(/\s+/g,` `).trim(),i=r?`${t} — ${r.length>60?`${r.slice(0,59)}…`:r}`:t,a=[t,e.author,r,e.id].filter(Boolean).join(`
`);return{annotation:e,text:i,title:a,search:a.toLocaleLowerCase()}}function pd({container:e,controller:t,onChange:n,onSelect:r,onHover:i}){let a=e.ownerDocument;e.innerHTML=`<details class="pdf-annotations"><summary>Annotations</summary>
    <label class="pdf-annotations-all"><input type="checkbox" /><span>All</span></label>
    <label class="pdf-annotations-filter">Filter annotations<input type="search" placeholder="Type, page, text or author" aria-label="Filter annotations" /></label>
    <button class="pdf-annotations-clear" type="button" disabled>Clear selection</button>
    <div class="pdf-annotations-list"></div>
    <div class="pdf-annotations-status" role="status" aria-live="polite"></div></details>`;let o=e.querySelector(`.pdf-annotations-all`),s=e.querySelector(`.pdf-annotations-all input`),c=e.querySelector(`.pdf-annotations-all span`),l=e.querySelector(`.pdf-annotations-filter`),u=e.querySelector(`.pdf-annotations-filter input`),d=e.querySelector(`.pdf-annotations-list`),f=e.querySelector(`.pdf-annotations-status`),p=e.querySelector(`.pdf-annotations`),m=e.querySelector(`.pdf-annotations-clear`);m.hidden=!r;let h=new Map,g=new Map,_=null,v=null,y=[],b=[],x=new Set,S=!1,C=0,w=0;function T(){let e=b.filter(e=>x.has(e.annotation.id)).length;s.checked=b.length>0&&e===0,s.indeterminate=e>0&&e<b.length;for(let[e,t]of h)for(let n of t)n.checked=!x.has(e);for(let[e,t]of g)for(let n of t)n.setAttribute(`aria-pressed`,String(e===_));m.disabled=_===null}async function E(e,r){let i=new Set(t.getAnnotationLayers().map(e=>e.annotationId)),a=e.filter(e=>i.has(e));if(!a.length)return;let o=C;w++,f.textContent=`Applying annotation visibility…`;let s,c=!1;try{await t.setAnnotationVisibility(a,r)}catch(e){c=!(e instanceof DOMException&&e.name===`AbortError`),s=e}if(S||o!==C)return;if(w--,!c){w||(f.textContent=``);return}let l=new Map(t.getAnnotationLayers().map(e=>[e.annotationId,e.visible]));for(let e of a)l.get(e)?x.delete(e):x.add(e);T(),f.textContent=`Annotation change failed: ${s instanceof Error?s.message:String(s)}. Try again.`,n?.()}function D(e,t){for(let n of e)t?x.delete(n):x.add(n);T(),E(e,t),n?.()}function O(){if(S)return;let e=u.value.trim().toLocaleLowerCase();b=e?y.filter(t=>t.search.includes(e)):y,o.hidden=l.hidden=y.length===0,c.textContent=e?`All matching`:`All`,o.title=e?`Turn every annotation that matches the filter on or off, including ones beyond the list limit.`:`Turn every annotation on or off, including ones beyond the list limit.`,g.size&&i?.(null),h.clear(),g.clear(),d.replaceChildren();let t=b.slice(0,ud),n=b.find(e=>e.annotation.id===_);n&&!t.includes(n)&&(t[t.length-1]=n);for(let e of t){let{annotation:t}=e,n=a.createElement(`div`);n.className=`pdf-annotation-row`;let o=a.createElement(`label`);o.title=e.title;let s=a.createElement(`input`);s.type=`checkbox`,s.addEventListener(`change`,()=>D([t.id],s.checked));let c=h.get(t.id)??[];c.push(s),h.set(t.id,c);let l=a.createElement(`span`);if(l.textContent=e.text,r){o.className=`pdf-annotation-visibility`,s.setAttribute(`aria-label`,`Show ${e.text}`),o.append(s);let c=a.createElement(`button`);c.type=`button`,c.className=`pdf-annotation-select`,c.title=e.title,c.append(l),c.addEventListener(`click`,()=>{j(t.id),r(t)}),c.addEventListener(`pointerenter`,()=>i?.(t)),c.addEventListener(`pointerleave`,()=>i?.(null)),c.addEventListener(`focus`,()=>i?.(t)),c.addEventListener(`blur`,()=>i?.(null));let u=g.get(t.id)??[];u.push(c),g.set(t.id,u),n.append(o,c)}else o.append(s,l),n.append(o);d.append(n)}if(!y.length)d.textContent=`This document has no annotations.`;else if(!b.length)d.textContent=`No matching annotations.`;else if(b.length>ud){let e=a.createElement(`div`);e.className=`pdf-annotations-more`,e.textContent=`Showing ${ud} of ${b.length}. Refine the filter to see the rest.`,d.append(e)}T()}function k(){if(S)return;let e=t.getScene();if(e===v){let e=t.getAnnotationLayers();for(let t of[!1,!0]){let n=e.filter(e=>e.visible!==t&&x.has(e.annotationId)!==t).map(e=>e.annotationId);n.length&&E(n,t)}return}v=e,_=null,C++,w=0,u.value=``,f.textContent=``,y=(e?.annotations??[]).filter(dd).map(fd),x=new Set(t.getAnnotationLayers().filter(e=>!e.visible).map(e=>e.annotationId)),O()}let A=()=>D(b.map(e=>e.annotation.id),s.checked);function j(e,t={}){if(!S){if(e!==null&&!y.some(t=>t.annotation.id===e))throw RangeError(`Unknown listed annotation: ${e}`);_=e,e!==null&&t.reveal?(p.open=!0,b.some(t=>t.annotation.id===e)||(u.value=``),O(),g.get(e)?.[0]?.scrollIntoView({block:`nearest`})):T()}}let M=()=>{j(null),i?.(null),r?.(null)};return m.addEventListener(`click`,M),s.addEventListener(`change`,A),u.addEventListener(`input`,O),k(),{isAnnotationEnabled(e){return!x.has(typeof e==`string`?e:e.id)},sceneChanged:k,selectAnnotation:j,getSelection:()=>_,dispose(){S||(S=!0,C++,s.removeEventListener(`change`,A),u.removeEventListener(`input`,O),m.removeEventListener(`click`,M),h.clear(),g.clear(),e.replaceChildren())}}}var md=`
  return smoothstep(-aaWorld, aaWorld, halfWidth - distanceValue)
    - smoothstep(-aaWorld, aaWorld, -halfWidth - distanceValue);
`,hd=`
float heprStrokeCoverage(float distanceValue, float halfWidth, float aaWorld) {
${md}}
`,gd=`
fn heprStrokeCoverage(distanceValue: f32, halfWidth: f32, aaWorld: f32) -> f32 {
${md}}
`,_d=`
  if (primitiveType >= 0.0) { return alpha; }
  return 1.0 - pow(1.0 - clamp(alpha, 0.0, 1.0), max(1.0, 1.0 - primitiveType));
`,vd=`
float heprStrokeLodAlpha(float alpha, float primitiveType) {
${_d}}
`,yd=`
fn heprStrokeLodAlpha(alpha: f32, primitiveType: f32) -> f32 {
${_d}}
`,bd=`
float heprCoverageRamp(float u) {
  float inside = clamp(u, 0.0, 1.0);
  return 0.5 * inside * inside + max(u - 1.0, 0.0);
}

float heprLineCoverage(vec2 a, vec2 b, float low, float high) {
  float va = clamp(a.y, low, high);
  float vb = clamp(b.y, low, high);
  if (va == vb) {
    return 0.0;
  }
  if (min(a.x, b.x) >= 1.0) {
    return vb - va;
  }
  if (max(a.x, b.x) <= 0.0) {
    return 0.0;
  }
  float dy = b.y - a.y;
  float ua = a.x + (b.x - a.x) * ((va - a.y) / dy);
  float ub = a.x + (b.x - a.x) * ((vb - a.y) / dy);
  float du = ub - ua;
  float mean = abs(du) < 0.0001
    ? clamp(0.5 * (ua + ub), 0.0, 1.0)
    : (heprCoverageRamp(ub) - heprCoverageRamp(ua)) / du;
  return (vb - va) * mean;
}

vec2 heprQuadraticPoint(vec2 a, vec2 b, vec2 c, float t) {
  float s = 1.0 - t;
  return vec2(
    s * s * a.x + 2.0 * s * t * b.x + t * t * c.x,
    s * s * a.y + 2.0 * s * t * b.y + t * t * c.y
  );
}

float heprQuadraticRoot(float qa, float qb, float qc, float t0, float t1) {
  float root = t0;
  if (qa == 0.0) {
    if (qb != 0.0) {
      root = -qc / qb;
    }
  } else {
    float q = -0.5 * (qb + (qb < 0.0 ? -1.0 : 1.0) * sqrt(max(qb * qb - 4.0 * qa * qc, 0.0)));
    float rootA = q / qa;
    float rootB = q == 0.0 ? rootA : qc / q;
    float missA = max(max(t0 - rootA, rootA - t1), 0.0);
    float missB = max(max(t0 - rootB, rootB - t1), 0.0);
    root = missB < missA ? rootB : rootA;
  }
  return clamp(root, t0, t1);
}

float heprQuadraticPieceCoverage(vec2 a, vec2 b, vec2 c, float t0, float t1, float low, float high) {
  if (t1 <= t0) {
    return 0.0;
  }
  vec2 startPoint = heprQuadraticPoint(a, b, c, t0);
  vec2 endPoint = heprQuadraticPoint(a, b, c, t1);
  float vStart = clamp(startPoint.y, low, high);
  float vEnd = clamp(endPoint.y, low, high);
  if (vStart == vEnd) {
    return 0.0;
  }
  float qa = a.y - 2.0 * b.y + c.y;
  float qb = 2.0 * (b.y - a.y);
  float ts = vStart == startPoint.y ? t0 : heprQuadraticRoot(qa, qb, a.y - vStart, t0, t1);
  float te = vEnd == endPoint.y ? t1 : heprQuadraticRoot(qa, qb, a.y - vEnd, t0, t1);
  float span = te - ts;
  float deviation = 0.25 * max(abs(a.x - 2.0 * b.x + c.x), abs(qa)) * span * span;
  int pieces = int(clamp(ceil(8.0 * sqrt(deviation)), 1.0, 8.0));
  vec2 previous = heprQuadraticPoint(a, b, c, ts);
  previous.y = vStart;
  float tPrevious = ts;
  float coverage = 0.0;
  for (int piece = 1; piece <= 8; piece += 1) {
    if (piece > pieces) {
      break;
    }
    float tNext = piece == pieces ? te : ts + span * float(piece) / float(pieces);
    vec2 next = heprQuadraticPoint(a, b, c, tNext);
    if (piece == pieces) {
      next.y = vEnd;
    }
    coverage += heprLineCoverage(previous, next, low, high);
    float sa = 1.0 - tPrevious;
    float sb = 1.0 - tNext;
    float blend = sa * tNext + tPrevious * sb;
    vec2 control = vec2(
      sa * sb * a.x + blend * b.x + tPrevious * tNext * c.x,
      sa * sb * a.y + blend * b.y + tPrevious * tNext * c.y
    );
    if (min(min(previous.x, next.x), control.x) >= 0.0 && max(max(previous.x, next.x), control.x) <= 1.0) {
      coverage += ((control.x - previous.x) * (next.y - previous.y) - (control.y - previous.y) * (next.x - previous.x)) / 3.0;
    }
    previous = next;
    tPrevious = tNext;
  }
  return coverage;
}

float heprQuadraticCoverage(vec2 a, vec2 b, vec2 c, float low, float high) {
  if (max(max(a.y, b.y), c.y) <= low || min(min(a.y, b.y), c.y) >= high || max(max(a.x, b.x), c.x) <= 0.0) {
    return 0.0;
  }
  float qa = a.y - 2.0 * b.y + c.y;
  float turn = qa == 0.0 ? 0.0 : clamp((a.y - b.y) / qa, 0.0, 1.0);
  if (min(min(a.x, b.x), c.x) >= 1.0) {
    float middle = clamp(heprQuadraticPoint(a, b, c, turn).y, low, high);
    return middle - clamp(a.y, low, high) + clamp(c.y, low, high) - middle;
  }
  return heprQuadraticPieceCoverage(a, b, c, 0.0, turn, low, high) +
    heprQuadraticPieceCoverage(a, b, c, turn, 1.0, low, high);
}

float heprSegmentCoverage(vec2 p0, vec2 p1, vec2 p2, bool quadratic, vec4 box, float low, float high) {
  vec2 a = vec2((p0.x - box.x) * box.z, (p0.y - box.y) * box.w);
  vec2 c = vec2((p2.x - box.x) * box.z, (p2.y - box.y) * box.w);
  
  
  float coverage = 0.0;
  if (quadratic) {
    vec2 b = vec2((p1.x - box.x) * box.z, (p1.y - box.y) * box.w);
    coverage = heprQuadraticCoverage(a, b, c, low, high);
  } else {
    coverage = heprLineCoverage(a, c, low, high);
  }
  return coverage;
}

vec2 heprBandRows(vec4 bandInfo, int band, int bandCount, vec4 box) {
  if (bandCount <= 0) {
    return vec2(0.0, 1.0);
  }
  float bandLow = bandInfo.z + float(band) * bandInfo.w;
  vec2 rows = vec2(
    clamp((bandLow - box.y) * box.w, 0.0, 1.0),
    clamp((bandLow + bandInfo.w - box.y) * box.w, 0.0, 1.0)
  );
  if (band == 0) {
    rows.x = 0.0;
  }
  if (band == bandCount - 1) {
    rows.y = 1.0;
  }
  return rows;
}

float heprFillCoverage(float winding, bool evenOdd) {
  float magnitude = abs(winding);
  return evenOdd
    ? abs(magnitude - 2.0 * floor(0.5 * magnitude + 0.5))
    : min(magnitude, 1.0);
}
`,xd=`
fn heprCoverageRamp(u: f32) -> f32 {
  let inside = clamp(u, 0.0, 1.0);
  return 0.5 * inside * inside + max(u - 1.0, 0.0);
}

fn heprLineCoverage(a: vec2<f32>, b: vec2<f32>, low: f32, high: f32) -> f32 {
  let va = clamp(a.y, low, high);
  let vb = clamp(b.y, low, high);
  if (va == vb) {
    return 0.0;
  }
  if (min(a.x, b.x) >= 1.0) {
    return vb - va;
  }
  if (max(a.x, b.x) <= 0.0) {
    return 0.0;
  }
  let dy = b.y - a.y;
  let ua = a.x + (b.x - a.x) * ((va - a.y) / dy);
  let ub = a.x + (b.x - a.x) * ((vb - a.y) / dy);
  let du = ub - ua;
  var mean = clamp(0.5 * (ua + ub), 0.0, 1.0);
  if (abs(du) >= 0.0001) {
    mean = (heprCoverageRamp(ub) - heprCoverageRamp(ua)) / du;
  }
  return (vb - va) * mean;
}

fn heprQuadraticPoint(a: vec2<f32>, b: vec2<f32>, c: vec2<f32>, t: f32) -> vec2<f32> {
  let s = 1.0 - t;
  return vec2<f32>(
    s * s * a.x + 2.0 * s * t * b.x + t * t * c.x,
    s * s * a.y + 2.0 * s * t * b.y + t * t * c.y
  );
}

fn heprQuadraticRoot(qa: f32, qb: f32, qc: f32, t0: f32, t1: f32) -> f32 {
  var root = t0;
  if (qa == 0.0) {
    if (qb != 0.0) {
      root = -qc / qb;
    }
  } else {
    let q = -0.5 * (qb + select(1.0, -1.0, qb < 0.0) * sqrt(max(qb * qb - 4.0 * qa * qc, 0.0)));
    let rootA = q / qa;
    var rootB = rootA;
    if (q != 0.0) {
      rootB = qc / q;
    }
    let missA = max(max(t0 - rootA, rootA - t1), 0.0);
    let missB = max(max(t0 - rootB, rootB - t1), 0.0);
    root = select(rootA, rootB, missB < missA);
  }
  return clamp(root, t0, t1);
}

fn heprQuadraticPieceCoverage(a: vec2<f32>, b: vec2<f32>, c: vec2<f32>, t0: f32, t1: f32, low: f32, high: f32) -> f32 {
  if (t1 <= t0) {
    return 0.0;
  }
  let startPoint = heprQuadraticPoint(a, b, c, t0);
  let endPoint = heprQuadraticPoint(a, b, c, t1);
  let vStart = clamp(startPoint.y, low, high);
  let vEnd = clamp(endPoint.y, low, high);
  if (vStart == vEnd) {
    return 0.0;
  }
  let qa = a.y - 2.0 * b.y + c.y;
  let qb = 2.0 * (b.y - a.y);
  var ts = t0;
  if (vStart != startPoint.y) {
    ts = heprQuadraticRoot(qa, qb, a.y - vStart, t0, t1);
  }
  var te = t1;
  if (vEnd != endPoint.y) {
    te = heprQuadraticRoot(qa, qb, a.y - vEnd, t0, t1);
  }
  let span = te - ts;
  let deviation = 0.25 * max(abs(a.x - 2.0 * b.x + c.x), abs(qa)) * span * span;
  let pieces = i32(clamp(ceil(8.0 * sqrt(deviation)), 1.0, 8.0));
  var previous = heprQuadraticPoint(a, b, c, ts);
  previous.y = vStart;
  var tPrevious = ts;
  var coverage = 0.0;
  for (var piece = 1; piece <= 8; piece = piece + 1) {
    if (piece > pieces) {
      break;
    }
    let tNext = select(ts + span * f32(piece) / f32(pieces), te, piece == pieces);
    var next = heprQuadraticPoint(a, b, c, tNext);
    if (piece == pieces) {
      next.y = vEnd;
    }
    coverage = coverage + heprLineCoverage(previous, next, low, high);
    let sa = 1.0 - tPrevious;
    let sb = 1.0 - tNext;
    let blend = sa * tNext + tPrevious * sb;
    let control = vec2<f32>(
      sa * sb * a.x + blend * b.x + tPrevious * tNext * c.x,
      sa * sb * a.y + blend * b.y + tPrevious * tNext * c.y
    );
    if (min(min(previous.x, next.x), control.x) >= 0.0 && max(max(previous.x, next.x), control.x) <= 1.0) {
      coverage = coverage + ((control.x - previous.x) * (next.y - previous.y) - (control.y - previous.y) * (next.x - previous.x)) / 3.0;
    }
    previous = next;
    tPrevious = tNext;
  }
  return coverage;
}

fn heprQuadraticCoverage(a: vec2<f32>, b: vec2<f32>, c: vec2<f32>, low: f32, high: f32) -> f32 {
  if (max(max(a.y, b.y), c.y) <= low || min(min(a.y, b.y), c.y) >= high || max(max(a.x, b.x), c.x) <= 0.0) {
    return 0.0;
  }
  let qa = a.y - 2.0 * b.y + c.y;
  var turn = 0.0;
  if (qa != 0.0) {
    turn = clamp((a.y - b.y) / qa, 0.0, 1.0);
  }
  if (min(min(a.x, b.x), c.x) >= 1.0) {
    let middle = clamp(heprQuadraticPoint(a, b, c, turn).y, low, high);
    return middle - clamp(a.y, low, high) + clamp(c.y, low, high) - middle;
  }
  return heprQuadraticPieceCoverage(a, b, c, 0.0, turn, low, high) +
    heprQuadraticPieceCoverage(a, b, c, turn, 1.0, low, high);
}

fn heprSegmentCoverage(p0: vec2<f32>, p1: vec2<f32>, p2: vec2<f32>, quadratic: bool, box: vec4<f32>, low: f32, high: f32) -> f32 {
  let a = vec2<f32>((p0.x - box.x) * box.z, (p0.y - box.y) * box.w);
  let c = vec2<f32>((p2.x - box.x) * box.z, (p2.y - box.y) * box.w);
  if (!quadratic) {
    return heprLineCoverage(a, c, low, high);
  }
  let b = vec2<f32>((p1.x - box.x) * box.z, (p1.y - box.y) * box.w);
  return heprQuadraticCoverage(a, b, c, low, high);
}

fn heprBandRows(bandInfo: vec4<f32>, band: i32, bandCount: i32, box: vec4<f32>) -> vec2<f32> {
  if (bandCount <= 0) {
    return vec2<f32>(0.0, 1.0);
  }
  let bandLow = bandInfo.z + f32(band) * bandInfo.w;
  var rows = vec2<f32>(
    clamp((bandLow - box.y) * box.w, 0.0, 1.0),
    clamp((bandLow + bandInfo.w - box.y) * box.w, 0.0, 1.0)
  );
  if (band == 0) {
    rows.x = 0.0;
  }
  if (band == bandCount - 1) {
    rows.y = 1.0;
  }
  return rows;
}

fn heprFillCoverage(winding: f32, evenOdd: bool) -> f32 {
  let magnitude = abs(winding);
  return select(min(magnitude, 1.0), abs(magnitude - 2.0 * floor(0.5 * magnitude + 0.5)), evenOdd);
}
`,Sd=`
mat2 heprPathToPixel(vec2 world, float useLocalToClip, mat4 localToClip, float zoom, vec2 viewport) {
  if (useLocalToClip < 0.5) {
    return mat2(zoom, 0.0, 0.0, zoom);
  }
  vec4 clip = localToClip * vec4(world, 0.0, 1.0);
  float w = abs(clip.w) > 1e-6 ? clip.w : 1e-6;
  vec2 ndc = clip.xy / w;
  vec2 halfViewport = 0.5 * viewport;
  return mat2(
    (localToClip[0].xy - ndc * localToClip[0].w) / w * halfViewport,
    (localToClip[1].xy - ndc * localToClip[1].w) / w * halfViewport
  );
}

vec2 heprCoverageMargin(mat2 pathToPixel) {
  float det = abs(pathToPixel[0][0] * pathToPixel[1][1] - pathToPixel[1][0] * pathToPixel[0][1]);
  if (!(det > 1e-30)) {
    return vec2(0.0);
  }
  return vec2(length(pathToPixel[1]), length(pathToPixel[0])) * (${1 .toFixed(1)} / det);
}




float heprCoverageExpansionScale(vec4 clip, vec4 deltaX, vec4 deltaY, vec2 viewport) {
  float w = abs(clip.w);
  if (!(w > 1e-6)) return 0.0;
  float relativeW = (abs(deltaX.w) + abs(deltaY.w)) / w;
  float pixelX = (abs(deltaX.x - clip.x / clip.w * deltaX.w) +
    abs(deltaY.x - clip.x / clip.w * deltaY.w)) * (0.5 * viewport.x / w);
  float pixelY = (abs(deltaX.y - clip.y / clip.w * deltaX.w) +
    abs(deltaY.y - clip.y / clip.w * deltaY.w)) * (0.5 * viewport.y / w);
  
  float demand = max(pixelX, pixelY) + 2.0 * relativeW;
  if (!(demand < 1e30) || !(relativeW < 1e30)) return 0.0;
  return min(1.0, min(0.25 / max(relativeW, 1e-30), 2.0 / max(demand, 1e-30)));
}

vec2 heprBoundCoverageMargin(vec2 world, vec2 margin, mat2 pathToWorld,
    float useLocalToClip, mat4 localToClip, vec2 viewport) {
  if (useLocalToClip < 0.5) return margin;
  vec4 clip = localToClip * vec4(world, 0.0, 1.0);
  vec4 deltaX = localToClip * vec4(pathToWorld[0] * margin.x, 0.0, 0.0);
  vec4 deltaY = localToClip * vec4(pathToWorld[1] * margin.y, 0.0, 0.0);
  float scale = heprCoverageExpansionScale(clip, deltaX, deltaY, viewport);
  
  if (!(scale > 0.0)) return vec2(0.0);
  return margin * scale;
}



float heprPixelCoverageExpansionScale(vec4 pathToPixel, vec2 margin, vec2 relativeDepth) {
  float relativeW = abs(relativeDepth.x) * margin.x + abs(relativeDepth.y) * margin.y;
  float pixelX = abs(pathToPixel.x) * margin.x + abs(pathToPixel.z) * margin.y;
  float pixelY = abs(pathToPixel.y) * margin.x + abs(pathToPixel.w) * margin.y;
  float demand = max(pixelX, pixelY) + 2.0 * relativeW;
  if (!(demand < 1e30) || !(relativeW < 1e30)) return 0.0;
  return min(1.0, min(0.25 / max(relativeW, 1e-30), 2.0 / max(demand, 1e-30)));
}

vec2 heprBoundCoverageMarginFromPixel(vec2 world, vec2 margin, mat2 pathToWorld, mat2 pathToPixel,
    float useLocalToClip, mat4 localToClip) {
  if (useLocalToClip < 0.5) return margin;
  vec2 depthSlope = vec2(localToClip[0].w, localToClip[1].w);
  float w = dot(depthSlope, world) + localToClip[3].w;
  if (!(abs(w) > 1e-6)) return vec2(0.0);
  vec2 relativeDepth = vec2(dot(depthSlope, pathToWorld[0]), dot(depthSlope, pathToWorld[1])) / w;
  float scale = heprPixelCoverageExpansionScale(vec4(pathToPixel[0], pathToPixel[1]), margin, relativeDepth);
  if (!(scale > 0.0)) return vec2(0.0);
  return margin * scale;
}
`,Cd=`
fn heprPathToPixel(world: vec2<f32>, useLocalToClip: f32, localToClip: mat4x4<f32>, zoom: f32, viewport: vec2<f32>) -> mat2x2<f32> {
  if (useLocalToClip < 0.5) {
    return mat2x2<f32>(zoom, 0.0, 0.0, zoom);
  }
  let clip = localToClip * vec4<f32>(world, 0.0, 1.0);
  let w = select(0.000001, clip.w, abs(clip.w) > 0.000001);
  let ndc = clip.xy / w;
  let halfViewport = 0.5 * viewport;
  return mat2x2<f32>(
    (localToClip[0].xy - ndc * localToClip[0].w) / w * halfViewport,
    (localToClip[1].xy - ndc * localToClip[1].w) / w * halfViewport
  );
}

fn heprCoverageMargin(pathToPixel: mat2x2<f32>) -> vec2<f32> {
  let det = abs(pathToPixel[0].x * pathToPixel[1].y - pathToPixel[1].x * pathToPixel[0].y);
  if (!(det > 1e-30)) {
    return vec2<f32>(0.0);
  }
  return vec2<f32>(length(pathToPixel[1]), length(pathToPixel[0])) * (${1 .toFixed(1)} / det);
}


fn heprCoverageExpansionScale(clip: vec4<f32>, deltaX: vec4<f32>, deltaY: vec4<f32>, viewport: vec2<f32>) -> f32 {
  let w = abs(clip.w);
  if (!(w > 0.000001)) { return 0.0; }
  let relativeW = (abs(deltaX.w) + abs(deltaY.w)) / w;
  let pixelX = (abs(deltaX.x - clip.x / clip.w * deltaX.w) +
    abs(deltaY.x - clip.x / clip.w * deltaY.w)) * (0.5 * viewport.x / w);
  let pixelY = (abs(deltaX.y - clip.y / clip.w * deltaX.w) +
    abs(deltaY.y - clip.y / clip.w * deltaY.w)) * (0.5 * viewport.y / w);
  let demand = max(pixelX, pixelY) + 2.0 * relativeW;
  if (!(demand < 1e30) || !(relativeW < 1e30)) { return 0.0; }
  return min(1.0, min(0.25 / max(relativeW, 1e-30), 2.0 / max(demand, 1e-30)));
}

fn heprBoundCoverageMargin(world: vec2<f32>, margin: vec2<f32>, pathToWorld: mat2x2<f32>,
    useLocalToClip: f32, localToClip: mat4x4<f32>, viewport: vec2<f32>) -> vec2<f32> {
  if (useLocalToClip < 0.5) { return margin; }
  let clip = localToClip * vec4<f32>(world, 0.0, 1.0);
  let deltaX = localToClip * vec4<f32>(pathToWorld[0] * margin.x, 0.0, 0.0);
  let deltaY = localToClip * vec4<f32>(pathToWorld[1] * margin.y, 0.0, 0.0);
  let scale = heprCoverageExpansionScale(clip, deltaX, deltaY, viewport);
  if (!(scale > 0.0)) { return vec2<f32>(0.0); }
  return margin * scale;
}


fn heprPixelCoverageExpansionScale(pathToPixel: vec4<f32>, margin: vec2<f32>, relativeDepth: vec2<f32>) -> f32 {
  let relativeW = abs(relativeDepth.x) * margin.x + abs(relativeDepth.y) * margin.y;
  let pixelX = abs(pathToPixel.x) * margin.x + abs(pathToPixel.z) * margin.y;
  let pixelY = abs(pathToPixel.y) * margin.x + abs(pathToPixel.w) * margin.y;
  let demand = max(pixelX, pixelY) + 2.0 * relativeW;
  if (!(demand < 1e30) || !(relativeW < 1e30)) { return 0.0; }
  return min(1.0, min(0.25 / max(relativeW, 1e-30), 2.0 / max(demand, 1e-30)));
}

fn heprBoundCoverageMarginFromPixel(world: vec2<f32>, margin: vec2<f32>, pathToWorld: mat2x2<f32>, pathToPixel: mat2x2<f32>,
    useLocalToClip: f32, localToClip: mat4x4<f32>) -> vec2<f32> {
  if (useLocalToClip < 0.5) { return margin; }
  let depthSlope = vec2<f32>(localToClip[0].w, localToClip[1].w);
  let w = dot(depthSlope, world) + localToClip[3].w;
  if (!(abs(w) > 0.000001)) { return vec2<f32>(0.0); }
  let relativeDepth = vec2<f32>(dot(depthSlope, pathToWorld[0]), dot(depthSlope, pathToWorld[1])) / w;
  let scale = heprPixelCoverageExpansionScale(vec4<f32>(pathToPixel[0], pathToPixel[1]), margin, relativeDepth);
  if (!(scale > 0.0)) { return vec2<f32>(0.0); }
  return margin * scale;
}
`,wd=`
vec4 heprClippedPaintQuad(vec2 minBounds, vec2 maxBounds, vec4 clipBounds, float useLocalToClip,
    mat4 localToClip, float zoom, vec2 viewport) {
  vec2 low = max(minBounds, clipBounds.xy);
  vec2 high = min(maxBounds, clipBounds.zw);
  vec2 a = min(low, high);
  vec2 b = max(low, high);
  vec2 margin = max(
    max(heprCoverageMargin(heprPathToPixel(a, useLocalToClip, localToClip, zoom, viewport)),
      heprCoverageMargin(heprPathToPixel(b, useLocalToClip, localToClip, zoom, viewport))),
    max(heprCoverageMargin(heprPathToPixel(vec2(a.x, b.y), useLocalToClip, localToClip, zoom, viewport)),
      heprCoverageMargin(heprPathToPixel(vec2(b.x, a.y), useLocalToClip, localToClip, zoom, viewport))));
  margin = min(
    min(heprBoundCoverageMargin(a, margin, mat2(1.0), useLocalToClip, localToClip, viewport),
      heprBoundCoverageMargin(b, margin, mat2(1.0), useLocalToClip, localToClip, viewport)),
    min(heprBoundCoverageMargin(vec2(a.x, b.y), margin, mat2(1.0), useLocalToClip, localToClip, viewport),
      heprBoundCoverageMargin(vec2(b.x, a.y), margin, mat2(1.0), useLocalToClip, localToClip, viewport)));
  return vec4(low - margin, high + margin);
}
`,Td=`
fn heprClippedPaintQuad(minBounds: vec2<f32>, maxBounds: vec2<f32>, clipBounds: vec4<f32>, useLocalToClip: f32,
    localToClip: mat4x4<f32>, zoom: f32, viewport: vec2<f32>) -> vec4<f32> {
  let low = max(minBounds, clipBounds.xy);
  let high = min(maxBounds, clipBounds.zw);
  let a = min(low, high);
  let b = max(low, high);
  var margin = max(
    max(heprCoverageMargin(heprPathToPixel(a, useLocalToClip, localToClip, zoom, viewport)),
      heprCoverageMargin(heprPathToPixel(b, useLocalToClip, localToClip, zoom, viewport))),
    max(heprCoverageMargin(heprPathToPixel(vec2<f32>(a.x, b.y), useLocalToClip, localToClip, zoom, viewport)),
      heprCoverageMargin(heprPathToPixel(vec2<f32>(b.x, a.y), useLocalToClip, localToClip, zoom, viewport))));
  let identity = mat2x2<f32>(1.0, 0.0, 0.0, 1.0);
  margin = min(
    min(heprBoundCoverageMargin(a, margin, identity, useLocalToClip, localToClip, viewport),
      heprBoundCoverageMargin(b, margin, identity, useLocalToClip, localToClip, viewport)),
    min(heprBoundCoverageMargin(vec2<f32>(a.x, b.y), margin, identity, useLocalToClip, localToClip, viewport),
      heprBoundCoverageMargin(vec2<f32>(b.x, a.y), margin, identity, useLocalToClip, localToClip, viewport)));
  return vec4<f32>(low - margin, high + margin);
}
`,Ed=`
float heprCellWinding(vec4 cells, vec2 origin, vec4 box, vec2 footprint) {
  float reach = 0.5 * max(footprint.x, footprint.y);
  float level = clamp(ceil(log2(max(reach / cells.z, 1.0)) / cells.w), 0.0, cells.y - 1.0);
  float size = cells.z * exp2(level * cells.w);
  if (size < reach && level < cells.y - 1.0) {
    level = level + 1.0;
    size = cells.z * exp2(level * cells.w);
  }
  vec4 grid = heprCellFetchA(int(cells.x + level));
  float right = box.x + footprint.x;
  int firstColumn = int(clamp(floor((box.x - origin.x) / size), 0.0, grid.y - 1.0));
  int lastColumn = int(clamp(floor((right - origin.x) / size), 0.0, grid.y - 1.0));
  int firstRow = int(clamp(floor((box.y - origin.y) / size), 0.0, grid.z - 1.0));
  int lastRow = int(clamp(floor((box.y + footprint.y - origin.y) / size), 0.0, grid.z - 1.0));
  vec4 rowGrid = vec4(0.0, 0.0, origin.y, size);
  float winding = 0.0;
  
  
  
  
  for (int row = firstRow; row <= lastRow; row += 1) {
    vec2 rows = heprBandRows(rowGrid, row, int(grid.z), box);
    int rowBase = int(grid.x + float(row) * grid.y);
    vec4 nextCell = heprCellFetchA(rowBase + firstColumn);
    for (int column = firstColumn; column <= lastColumn; column += 1) {
      vec4 cell = nextCell;
      nextCell = heprCellFetchA(rowBase + min(column + 1, lastColumn));
      
      float low = column == 0 ? box.x : max(box.x, origin.x + float(column) * size);
      float high = column == int(grid.y) - 1 ? right : min(right, origin.x + float(column + 1) * size);
      if (high > low) {
        vec4 part = vec4(low, box.y, 1.0 / (high - low), box.w);
        float cellWinding = 0.0;
        int first = int(cell.x);
        int count = int(abs(cell.y));
        int last = first + count - 1;
        if (cell.y > 0.0) {
          
          
          for (int piece = 0; piece < count; piece += 4) {
            vec4 l0 = heprCellFetchA(first + piece);
            vec4 l1 = heprCellFetchA(min(first + piece + 1, last));
            vec4 l2 = heprCellFetchA(min(first + piece + 2, last));
            vec4 l3 = heprCellFetchA(min(first + piece + 3, last));
            cellWinding += heprSegmentCoverage(vec2(l0.x, l0.y), vec2(l0.x, l0.y), vec2(l0.z, l0.w), false,
              part, rows.x, rows.y);
            cellWinding += heprSegmentCoverage(vec2(l1.x, l1.y), vec2(l1.x, l1.y), vec2(l1.z, l1.w), false,
              part, rows.x, piece + 1 < count ? rows.y : rows.x);
            cellWinding += heprSegmentCoverage(vec2(l2.x, l2.y), vec2(l2.x, l2.y), vec2(l2.z, l2.w), false,
              part, rows.x, piece + 2 < count ? rows.y : rows.x);
            cellWinding += heprSegmentCoverage(vec2(l3.x, l3.y), vec2(l3.x, l3.y), vec2(l3.z, l3.w), false,
              part, rows.x, piece + 3 < count ? rows.y : rows.x);
          }
        } else if (count > 0) {
          vec4 nextA = heprCellFetchA(first);
          vec4 nextB = heprCellFetchB(first);
          for (int piece = 0; piece < count; piece += 1) {
            vec4 a = nextA;
            vec4 b = nextB;
            int following = min(first + piece + 1, last);
            nextA = heprCellFetchA(following);
            nextB = heprCellFetchB(following);
            cellWinding += heprSegmentCoverage(vec2(a.x, a.y), vec2(b.x, b.y), vec2(a.z, a.w), b.z >= 0.5,
              part, rows.x, rows.y);
          }
        }
        int closures = int(cell.z);
        int closureCount = int(cell.w);
        for (int closure = 0; closure < closureCount; closure += 2) {
          vec4 pair = heprCellFetchA(closures + closure);
          vec4 pair2 = heprCellFetchA(closures + min(closure + 1, closureCount - 1));
          float more = closure + 1 < closureCount ? 1.0 : 0.0;
          cellWinding += pair.y * (clamp((pair.x - box.y) * box.w, rows.x, rows.y) - rows.y);
          cellWinding += pair.w * (clamp((pair.z - box.y) * box.w, rows.x, rows.y) - rows.y);
          cellWinding += more * pair2.y * (clamp((pair2.x - box.y) * box.w, rows.x, rows.y) - rows.y);
          cellWinding += more * pair2.w * (clamp((pair2.z - box.y) * box.w, rows.x, rows.y) - rows.y);
        }
        winding += cellWinding * (high - low) / footprint.x;
      }
    }
  }
  return winding;
}
`,Dd=`
fn heprCellWinding(cells: vec4<f32>, origin: vec2<f32>, box: vec4<f32>, footprint: vec2<f32>,
    segmentsA: texture_2d<f32>, segmentsB: texture_2d<f32>) -> f32 {
  let reach = 0.5 * max(footprint.x, footprint.y);
  var level = clamp(ceil(log2(max(reach / cells.z, 1.0)) / cells.w), 0.0, cells.y - 1.0);
  var size = cells.z * exp2(level * cells.w);
  if (size < reach && level < cells.y - 1.0) {
    level = level + 1.0;
    size = cells.z * exp2(level * cells.w);
  }
  let grid = heprCellTexel(segmentsA, i32(cells.x + level));
  let right = box.x + footprint.x;
  let firstColumn = i32(clamp(floor((box.x - origin.x) / size), 0.0, grid.y - 1.0));
  let lastColumn = i32(clamp(floor((right - origin.x) / size), 0.0, grid.y - 1.0));
  let firstRow = i32(clamp(floor((box.y - origin.y) / size), 0.0, grid.z - 1.0));
  let lastRow = i32(clamp(floor((box.y + footprint.y - origin.y) / size), 0.0, grid.z - 1.0));
  let rowGrid = vec4<f32>(0.0, 0.0, origin.y, size);
  var winding = 0.0;
  
  for (var row = firstRow; row <= lastRow; row = row + 1) {
    let rows = heprBandRows(rowGrid, row, i32(grid.z), box);
    let rowBase = i32(grid.x + f32(row) * grid.y);
    var nextCell = heprCellTexel(segmentsA, rowBase + firstColumn);
    for (var column = firstColumn; column <= lastColumn; column = column + 1) {
      let cell = nextCell;
      nextCell = heprCellTexel(segmentsA, rowBase + min(column + 1, lastColumn));
      
      var low = max(box.x, origin.x + f32(column) * size);
      if (column == 0) {
        low = box.x;
      }
      var high = min(right, origin.x + f32(column + 1) * size);
      if (column == i32(grid.y) - 1) {
        high = right;
      }
      if (high > low) {
        let part = vec4<f32>(low, box.y, 1.0 / (high - low), box.w);
        var cellWinding = 0.0;
        let first = i32(cell.x);
        let count = i32(abs(cell.y));
        let last = first + count - 1;
        if (cell.y > 0.0) {
          
          
          for (var piece = 0; piece < count; piece = piece + 4) {
            let l0 = heprCellTexel(segmentsA, first + piece);
            let l1 = heprCellTexel(segmentsA, min(first + piece + 1, last));
            let l2 = heprCellTexel(segmentsA, min(first + piece + 2, last));
            let l3 = heprCellTexel(segmentsA, min(first + piece + 3, last));
            cellWinding = cellWinding + heprCellLine(l0, part, rows.x, rows.y) +
              heprCellLine(l1, part, rows.x, select(rows.x, rows.y, piece + 1 < count)) +
              heprCellLine(l2, part, rows.x, select(rows.x, rows.y, piece + 2 < count)) +
              heprCellLine(l3, part, rows.x, select(rows.x, rows.y, piece + 3 < count));
          }
        } else if (count > 0) {
          var nextA = heprCellTexel(segmentsA, first);
          var nextB = heprCellTexel(segmentsB, first);
          for (var piece = 0; piece < count; piece = piece + 1) {
            let a = nextA;
            let b = nextB;
            let following = min(first + piece + 1, last);
            nextA = heprCellTexel(segmentsA, following);
            nextB = heprCellTexel(segmentsB, following);
            cellWinding = cellWinding + heprSegmentCoverage(vec2<f32>(a.x, a.y), vec2<f32>(b.x, b.y),
              vec2<f32>(a.z, a.w), b.z >= 0.5, part, rows.x, rows.y);
          }
        }
        let closures = i32(cell.z);
        let closureCount = i32(cell.w);
        for (var closure = 0; closure < closureCount; closure = closure + 2) {
          let pair = heprCellTexel(segmentsA, closures + closure);
          let pair2 = heprCellTexel(segmentsA, closures + min(closure + 1, closureCount - 1));
          let more = select(0.0, 1.0, closure + 1 < closureCount);
          cellWinding = cellWinding + pair.y * (clamp((pair.x - box.y) * box.w, rows.x, rows.y) - rows.y) +
            pair.w * (clamp((pair.z - box.y) * box.w, rows.x, rows.y) - rows.y) +
            more * pair2.y * (clamp((pair2.x - box.y) * box.w, rows.x, rows.y) - rows.y) +
            more * pair2.w * (clamp((pair2.z - box.y) * box.w, rows.x, rows.y) - rows.y);
        }
        winding = winding + cellWinding * (high - low) / footprint.x;
      }
    }
  }
  return winding;
}

fn heprCellTexel(segments: texture_2d<f32>, index: i32) -> vec4<f32> {
  let width = i32(textureDimensions(segments).x);
  return textureLoad(segments, vec2<i32>(index % width, index / width), 0);
}

fn heprCellLine(line: vec4<f32>, part: vec4<f32>, low: f32, high: f32) -> f32 {
  return heprSegmentCoverage(vec2<f32>(line.x, line.y), vec2<f32>(line.x, line.y), vec2<f32>(line.z, line.w), false,
    part, low, high);
}
`,Od=`
fn heprFillCellInfo(pathIndex: f32, headers: f32, segments: texture_2d<f32>) -> vec4<f32> {
  if (headers <= 0.0) { return vec4<f32>(0.0); }
  let width = i32(textureDimensions(segments).x);
  let index = i32(headers - 1.0 + pathIndex + 0.5);
  return textureLoad(segments, vec2<i32>(index % width, index / width), 0);
}
`,kd=`
float heprVectorClip(vec2 point) {
  highp int index = int(uVectorClipIndex);
  for (highp int depth = 0; depth < 64; depth++) {
    if (index < 0) break;
    vec4 node = heprClipTexel(index);
    if (node.z < 0.0) {
      vec4 bounds = heprClipTexel(int(node.y));
      
      if (any(lessThan(point, bounds.xy)) || any(greaterThanEqual(point, bounds.zw))) return 0.0;
      index = int(node.x);
      continue;
    }
    highp int flags = int(node.w);
    highp int winding = 0;
    if ((flags & 4) != 0) {
      vec4 cells = heprClipTexel(int(node.y));
      vec4 origin = heprClipTexel(int(node.y) + 1);
      vec4 grid = heprClipTexel(int(cells.x));
      vec2 home = clamp(floor((point - origin.xy) / cells.z), vec2(0.0), grid.yz - 1.0);
      vec4 cell = heprClipTexel(int(grid.x + home.y * grid.y + home.x));
      for (highp int piece = 0; piece < ${un}; piece++) {
        if (piece >= int(cell.y)) break;
        vec4 line = heprClipTexel(int(cell.x) + piece);
        if ((line.y > point.y) != (line.w > point.y)) {
          float x = line.x + (point.y - line.y) / (line.w - line.y) * (line.z - line.x);
          if (x > point.x) winding += line.w > line.y ? 1 : -1;
        }
      }
      for (highp int closure = 0; closure < ${un}; closure++) {
        if (closure >= int(cell.w)) break;
        vec4 pair = heprClipTexel(int(cell.z) + closure);
        if (pair.x <= point.y) winding -= int(pair.y);
        if (pair.z <= point.y) winding -= int(pair.w);
      }
    } else {
      highp int firstEdge = int(node.y);
      highp int edgeCount = int(node.z);
      if ((flags & 2) != 0) {
        vec4 bands = heprClipTexel(int(node.y));
        
        highp int band = int(clamp(floor((point.y - bands.y) / bands.z), 0.0, bands.w - 1.0));
        vec4 range = heprClipTexel(int(bands.x) + band);
        firstEdge = int(range.x);
        edgeCount = int(range.y);
      }
      for (highp int edge = 0; edge < ${un}; edge++) {
        if (edge >= edgeCount) break;
        vec4 line = heprClipTexel(firstEdge + edge);
        if ((line.y > point.y) != (line.w > point.y)) {
          float x = line.x + (point.y - line.y) / (line.w - line.y) * (line.z - line.x);
          if (x > point.x) winding += line.w > line.y ? 1 : -1;
        }
      }
    }
    bool inside = (flags & 1) != 0 ? (abs(winding) % 2 != 0) : winding != 0;
    if (!inside) return 0.0;
    index = int(node.x);
  }
  if (index >= 0) return 0.0;
  return 1.0;
}
`,Ad=`

const vec4 VECTOR_CLIP_SAMPLE_OFFSETS = vec4(-0.375, -0.125, 0.125, 0.375);

uint heprSampleBits(vec4 inside) {
  return (inside.x > 0.5 ? 1u : 0u) | (inside.y > 0.5 ? 2u : 0u) |
    (inside.z > 0.5 ? 4u : 0u) | (inside.w > 0.5 ? 8u : 0u);
}

uint heprSampleGrid(uint row0, uint row1, uint row2, uint row3) {
  return row0 | (row1 << 4) | (row2 << 8) | (row3 << 12);
}

float heprSampleCoverage(uint samples) {
  uint count = samples - ((samples >> 1) & 0x5555u);
  count = (count & 0x3333u) + ((count >> 2) & 0x3333u);
  count = (count + (count >> 4)) & 0x0F0Fu;
  return float((count + (count >> 8)) & 0x1Fu) * 0.0625;
}


uint heprClipRectSamples(vec4 bounds, vec4 sampleX, vec4 sampleY) {
  uint columns = heprSampleBits(step(bounds.xxxx, sampleX) * (1.0 - step(bounds.zzzz, sampleX)));
  vec4 rows = step(bounds.yyyy, sampleY) * (1.0 - step(bounds.wwww, sampleY));
  return heprSampleGrid(rows.x > 0.5 ? columns : 0u, rows.y > 0.5 ? columns : 0u,
    rows.z > 0.5 ? columns : 0u, rows.w > 0.5 ? columns : 0u);
}



void heprClipSampleCrossings(vec4 line, vec4 sampleX, vec4 sampleY, vec4 rows, vec4 columns,
    inout vec4 winding0, inout vec4 winding1, inout vec4 winding2, inout vec4 winding3) {
  vec4 crossing = abs(vec4(greaterThan(vec4(line.y), sampleY)) - vec4(greaterThan(vec4(line.w), sampleY))) * rows;
  if (any(greaterThan(crossing, vec4(0.0)))) {
    vec4 x = line.x + (sampleY - line.y) / (line.w - line.y) * (line.z - line.x);
    crossing *= line.w > line.y ? 1.0 : -1.0;
    winding0 += crossing.x * columns * vec4(greaterThan(x.xxxx, sampleX));
    winding1 += crossing.y * columns * vec4(greaterThan(x.yyyy, sampleX));
    winding2 += crossing.z * columns * vec4(greaterThan(x.zzzz, sampleX));
    winding3 += crossing.w * columns * vec4(greaterThan(x.wwww, sampleX));
  }
}



void heprClipSampleEdges(highp int first, highp int count, vec4 sampleX, vec4 sampleY, vec4 rows, vec4 columns,
    inout vec4 winding0, inout vec4 winding1, inout vec4 winding2, inout vec4 winding3) {
  for (highp int edge = 0; edge < ${un}; edge += 4) {
    if (edge >= count) break;
    highp int last = first + count - 1;
    vec4 line0 = heprClipTexel(first + edge);
    vec4 line1 = heprClipTexel(min(first + edge + 1, last));
    vec4 line2 = heprClipTexel(min(first + edge + 2, last));
    vec4 line3 = heprClipTexel(min(first + edge + 3, last));
    heprClipSampleCrossings(line0, sampleX, sampleY, rows, columns, winding0, winding1, winding2, winding3);
    heprClipSampleCrossings(line1, sampleX, sampleY, edge + 1 < count ? rows : vec4(0.0), columns,
      winding0, winding1, winding2, winding3);
    heprClipSampleCrossings(line2, sampleX, sampleY, edge + 2 < count ? rows : vec4(0.0), columns,
      winding0, winding1, winding2, winding3);
    heprClipSampleCrossings(line3, sampleX, sampleY, edge + 3 < count ? rows : vec4(0.0), columns,
      winding0, winding1, winding2, winding3);
  }
}



vec4 heprClipClosuresBelow(vec4 pair, vec4 sampleY) {
  return pair.y * step(vec4(pair.x), sampleY) + pair.w * step(vec4(pair.z), sampleY);
}

uint heprSampleInside(vec4 winding, bool evenOdd) {
  return heprSampleBits(evenOdd ? mod(abs(winding), 2.0) : abs(winding));
}


uint heprClipPolygonSamples(vec4 node, vec4 sampleX, vec4 sampleY, float span) {
  highp int flags = int(node.w);
  vec4 winding0 = vec4(0.0);
  vec4 winding1 = vec4(0.0);
  vec4 winding2 = vec4(0.0);
  vec4 winding3 = vec4(0.0);
  if ((flags & 4) != 0) {
    vec4 cells = heprClipTexel(int(node.y));
    vec4 origin = heprClipTexel(int(node.y) + 1);
    float level = heprClipCellLevel(cells, span);
    float size = cells.z * exp2(level * cells.w);
    vec4 grid = heprClipTexel(int(cells.x + level));
    
    vec4 columnOf = clamp(floor((sampleX - origin.x) / size), 0.0, grid.y - 1.0);
    vec4 rowOf = clamp(floor((sampleY - origin.y) / size), 0.0, grid.z - 1.0);
    for (highp int row = int(rowOf.x); row <= int(rowOf.w); row++) {
      vec4 rows = vec4(equal(rowOf, vec4(float(row))));
      for (highp int column = int(columnOf.x); column <= int(columnOf.w); column++) {
        vec4 columns = vec4(equal(columnOf, vec4(float(column))));
        vec4 cell = heprClipTexel(int(grid.x) + row * int(grid.y) + column);
        heprClipSampleEdges(int(cell.x), int(cell.y), sampleX, sampleY, rows, columns,
          winding0, winding1, winding2, winding3);
        highp int closures = int(cell.z);
        highp int closureCount = int(cell.w);
        for (highp int closure = 0; closure < ${un}; closure += 2) {
          if (closure >= closureCount) break;
          vec4 pair0 = heprClipTexel(closures + closure);
          vec4 pair1 = heprClipTexel(closures + min(closure + 1, closureCount - 1));
          vec4 below = (heprClipClosuresBelow(pair0, sampleY) +
            (closure + 1 < closureCount ? heprClipClosuresBelow(pair1, sampleY) : vec4(0.0))) * rows;
          winding0 -= below.x * columns;
          winding1 -= below.y * columns;
          winding2 -= below.z * columns;
          winding3 -= below.w * columns;
        }
      }
    }
  } else {
    vec4 bands = vec4(0.0);
    vec4 bandOf = vec4(0.0);
    if ((flags & 2) != 0) {
      bands = heprClipTexel(int(node.y));
      bandOf = clamp(floor((sampleY - bands.y) / bands.z), 0.0, bands.w - 1.0);
    }
    for (highp int band = int(bandOf.x); band <= int(bandOf.w); band++) {
      highp int firstEdge = int(node.y);
      highp int edgeCount = int(node.z);
      if ((flags & 2) != 0) {
        vec4 range = heprClipTexel(int(bands.x) + band);
        firstEdge = int(range.x);
        edgeCount = int(range.y);
      }
      
      heprClipSampleEdges(firstEdge, edgeCount, sampleX, sampleY, vec4(equal(bandOf, vec4(float(band)))),
        vec4(1.0), winding0, winding1, winding2, winding3);
    }
  }
  bool evenOdd = (flags & 1) != 0;
  return heprSampleGrid(heprSampleInside(winding0, evenOdd), heprSampleInside(winding1, evenOdd),
    heprSampleInside(winding2, evenOdd), heprSampleInside(winding3, evenOdd));
}

float heprVectorClipAA(vec2 point, float aaWidth) {
  vec4 sampleX = point.x + VECTOR_CLIP_SAMPLE_OFFSETS * aaWidth;
  vec4 sampleY = point.y + VECTOR_CLIP_SAMPLE_OFFSETS * aaWidth;
  float span = 0.75 * aaWidth;
  uint samples = 0xFFFFu;
  highp int index = int(uVectorClipIndex);
  for (highp int depth = 0; depth < 64; depth++) {
    if (index < 0) break;
    vec4 node = heprClipTexel(index);
    samples &= node.z < 0.0 ? heprClipRectSamples(heprClipTexel(int(node.y)), sampleX, sampleY)
      : heprClipPolygonSamples(node, sampleX, sampleY, span);
    if (samples == 0u) return 0.0;
    index = int(node.x);
  }
  if (index >= 0) return 0.0;
  return heprSampleCoverage(samples);
}
`,jd=`
uniform highp sampler2D uVectorClipTex;
uniform float uVectorClipIndex;
vec4 heprClipTexel(highp int index) {
  highp int width = textureSize(uVectorClipTex, 0).x;
  return texelFetch(uVectorClipTex, ivec2(index % width, index / width), 0);
}


float heprClipCellLevel(vec4 cells, float reach) {
  float level = clamp(ceil(log2(max(reach / cells.z, 1.0)) / cells.w), 0.0, cells.y - 1.0);
  if (cells.z * exp2(level * cells.w) < reach && level < cells.y - 1.0) level += 1.0;
  return level;
}
`+kd+Ad,Md=`
fn heprVectorClip(point: vec2<f32>, clipIndex: f32, clipTexture: texture_2d<f32>) -> f32 {
  var index = i32(clipIndex);
  for (var depth = 0; depth < 64; depth++) {
    if (index < 0) { break; }
    let node = heprClipTexel(clipTexture, index);
    if (node.z < 0.0) {
      let bounds = heprClipTexel(clipTexture, i32(node.y));
      
      if (any(point < bounds.xy) || any(point >= bounds.zw)) { return 0.0; }
      index = i32(node.x);
      continue;
    }
    let flags = i32(node.w);
    var winding = 0;
    if ((flags & 4) != 0) {
      let cells = heprClipTexel(clipTexture, i32(node.y));
      let origin = heprClipTexel(clipTexture, i32(node.y) + 1);
      let grid = heprClipTexel(clipTexture, i32(cells.x));
      let home = clamp(floor((point - origin.xy) / cells.z), vec2<f32>(0.0), grid.yz - vec2<f32>(1.0));
      let cell = heprClipTexel(clipTexture, i32(grid.x + home.y * grid.y + home.x));
      for (var piece = 0; piece < i32(cell.y); piece++) {
        let line = heprClipTexel(clipTexture, i32(cell.x) + piece);
        if ((line.y > point.y) != (line.w > point.y)) {
          let x = line.x + (point.y - line.y) / (line.w - line.y) * (line.z - line.x);
          if (x > point.x) { winding += select(-1, 1, line.w > line.y); }
        }
      }
      for (var closure = 0; closure < i32(cell.w); closure++) {
        let pair = heprClipTexel(clipTexture, i32(cell.z) + closure);
        if (pair.x <= point.y) { winding -= i32(pair.y); }
        if (pair.z <= point.y) { winding -= i32(pair.w); }
      }
    } else {
      var firstEdge = i32(node.y);
      var edgeCount = i32(node.z);
      if ((flags & 2) != 0) {
        let bands = heprClipTexel(clipTexture, i32(node.y));
        
        let band = i32(clamp(floor((point.y - bands.y) / bands.z), 0.0, bands.w - 1.0));
        let range = heprClipTexel(clipTexture, i32(bands.x) + band);
        firstEdge = i32(range.x);
        edgeCount = i32(range.y);
      }
      for (var edge = 0; edge < edgeCount; edge++) {
        let line = heprClipTexel(clipTexture, firstEdge + edge);
        if ((line.y > point.y) != (line.w > point.y)) {
          let x = line.x + (point.y - line.y) / (line.w - line.y) * (line.z - line.x);
          if (x > point.x) { winding += select(-1, 1, line.w > line.y); }
        }
      }
    }
    let inside = select(winding != 0, abs(winding) % 2 != 0, (flags & 1) != 0);
    if (!inside) { return 0.0; }
    index = i32(node.x);
  }
  if (index >= 0) { return 0.0; }
  return 1.0;
}

fn heprClipTexel(clipTexture: texture_2d<f32>, index: i32) -> vec4<f32> {
  let width = i32(textureDimensions(clipTexture).x);
  return textureLoad(clipTexture, vec2<i32>(index % width, index / width), 0);
}
`,Nd=`
fn heprVectorClipAA(point: vec2<f32>, clipIndex: f32, clipTexture: texture_2d<f32>, aaWidth: f32) -> f32 {
  
  let offsets = vec4<f32>(-0.375, -0.125, 0.125, 0.375);
  let sampleX = point.x + offsets * aaWidth;
  let sampleY = point.y + offsets * aaWidth;
  let span = 0.75 * aaWidth;
  var samples = 0xFFFFu;
  var index = i32(clipIndex);
  for (var depth = 0; depth < 64; depth++) {
    if (index < 0) { break; }
    let node = heprClipTexel(clipTexture, index);
    if (node.z < 0.0) {
      samples &= heprClipRectSamples(heprClipTexel(clipTexture, i32(node.y)), sampleX, sampleY);
    } else {
      samples &= heprClipPolygonSamples(clipTexture, node, sampleX, sampleY, span);
    }
    if (samples == 0u) { return 0.0; }
    index = i32(node.x);
  }
  if (index >= 0) { return 0.0; }
  return f32(countOneBits(samples)) * 0.0625;
}

fn heprClipSampleBits(inside: vec4<bool>) -> u32 {
  return select(0u, 1u, inside.x) | select(0u, 2u, inside.y) | select(0u, 4u, inside.z) | select(0u, 8u, inside.w);
}

fn heprClipSampleGrid(row0: u32, row1: u32, row2: u32, row3: u32) -> u32 {
  return row0 | (row1 << 4u) | (row2 << 8u) | (row3 << 12u);
}


fn heprClipRectSamples(bounds: vec4<f32>, sampleX: vec4<f32>, sampleY: vec4<f32>) -> u32 {
  let columns = heprClipSampleBits((sampleX >= vec4<f32>(bounds.x)) & (sampleX < vec4<f32>(bounds.z)));
  let rows = (sampleY >= vec4<f32>(bounds.y)) & (sampleY < vec4<f32>(bounds.w));
  return heprClipSampleGrid(select(0u, columns, rows.x), select(0u, columns, rows.y),
    select(0u, columns, rows.z), select(0u, columns, rows.w));
}


fn heprClipCellLevel(cells: vec4<f32>, reach: f32) -> f32 {
  var level = clamp(ceil(log2(max(reach / cells.z, 1.0)) / cells.w), 0.0, cells.y - 1.0);
  if (cells.z * exp2(level * cells.w) < reach && level < cells.y - 1.0) { level += 1.0; }
  return level;
}

fn heprClipMask(condition: vec4<bool>) -> vec4<f32> {
  return select(vec4<f32>(0.0), vec4<f32>(1.0), condition);
}



fn heprClipSampleCrossings(line: vec4<f32>, sampleX: vec4<f32>, sampleY: vec4<f32>, rows: vec4<f32>,
    columns: vec4<f32>, winding0: ptr<function, vec4<f32>>, winding1: ptr<function, vec4<f32>>,
    winding2: ptr<function, vec4<f32>>, winding3: ptr<function, vec4<f32>>) {
  var crossing = abs(heprClipMask(vec4<f32>(line.y) > sampleY) - heprClipMask(vec4<f32>(line.w) > sampleY)) * rows;
  if (any(crossing > vec4<f32>(0.0))) {
    let x = line.x + (sampleY - line.y) / (line.w - line.y) * (line.z - line.x);
    crossing *= select(-1.0, 1.0, line.w > line.y);
    *winding0 += crossing.x * columns * heprClipMask(vec4<f32>(x.x) > sampleX);
    *winding1 += crossing.y * columns * heprClipMask(vec4<f32>(x.y) > sampleX);
    *winding2 += crossing.z * columns * heprClipMask(vec4<f32>(x.z) > sampleX);
    *winding3 += crossing.w * columns * heprClipMask(vec4<f32>(x.w) > sampleX);
  }
}



fn heprClipSampleEdges(clipTexture: texture_2d<f32>, first: i32, count: i32, sampleX: vec4<f32>,
    sampleY: vec4<f32>, rows: vec4<f32>, columns: vec4<f32>, winding0: ptr<function, vec4<f32>>,
    winding1: ptr<function, vec4<f32>>, winding2: ptr<function, vec4<f32>>, winding3: ptr<function, vec4<f32>>) {
  let last = first + count - 1;
  for (var edge = 0; edge < count; edge += 4) {
    let line0 = heprClipTexel(clipTexture, first + edge);
    let line1 = heprClipTexel(clipTexture, min(first + edge + 1, last));
    let line2 = heprClipTexel(clipTexture, min(first + edge + 2, last));
    let line3 = heprClipTexel(clipTexture, min(first + edge + 3, last));
    heprClipSampleCrossings(line0, sampleX, sampleY, rows, columns, winding0, winding1, winding2, winding3);
    heprClipSampleCrossings(line1, sampleX, sampleY, select(vec4<f32>(0.0), rows, edge + 1 < count), columns,
      winding0, winding1, winding2, winding3);
    heprClipSampleCrossings(line2, sampleX, sampleY, select(vec4<f32>(0.0), rows, edge + 2 < count), columns,
      winding0, winding1, winding2, winding3);
    heprClipSampleCrossings(line3, sampleX, sampleY, select(vec4<f32>(0.0), rows, edge + 3 < count), columns,
      winding0, winding1, winding2, winding3);
  }
}



fn heprClipClosuresBelow(pair: vec4<f32>, sampleY: vec4<f32>) -> vec4<f32> {
  return pair.y * step(vec4<f32>(pair.x), sampleY) + pair.w * step(vec4<f32>(pair.z), sampleY);
}

fn heprClipSampleInside(winding: vec4<f32>, evenOdd: bool) -> u32 {
  var value = abs(winding);
  if (evenOdd) { value -= 2.0 * floor(0.5 * value); }
  return heprClipSampleBits(value > vec4<f32>(0.5));
}


fn heprClipPolygonSamples(clipTexture: texture_2d<f32>, node: vec4<f32>, sampleX: vec4<f32>, sampleY: vec4<f32>,
    span: f32) -> u32 {
  let flags = i32(node.w);
  var winding0 = vec4<f32>(0.0);
  var winding1 = vec4<f32>(0.0);
  var winding2 = vec4<f32>(0.0);
  var winding3 = vec4<f32>(0.0);
  if ((flags & 4) != 0) {
    let cells = heprClipTexel(clipTexture, i32(node.y));
    let origin = heprClipTexel(clipTexture, i32(node.y) + 1);
    let level = heprClipCellLevel(cells, span);
    let size = cells.z * exp2(level * cells.w);
    let grid = heprClipTexel(clipTexture, i32(cells.x + level));
    
    let columnOf = clamp(floor((sampleX - origin.x) / size), vec4<f32>(0.0), vec4<f32>(grid.y - 1.0));
    let rowOf = clamp(floor((sampleY - origin.y) / size), vec4<f32>(0.0), vec4<f32>(grid.z - 1.0));
    for (var row = i32(rowOf.x); row <= i32(rowOf.w); row++) {
      let rows = heprClipMask(rowOf == vec4<f32>(f32(row)));
      for (var column = i32(columnOf.x); column <= i32(columnOf.w); column++) {
        let columns = heprClipMask(columnOf == vec4<f32>(f32(column)));
        let cell = heprClipTexel(clipTexture, i32(grid.x) + row * i32(grid.y) + column);
        heprClipSampleEdges(clipTexture, i32(cell.x), i32(cell.y), sampleX, sampleY, rows, columns,
          &winding0, &winding1, &winding2, &winding3);
        let closures = i32(cell.z);
        let closureCount = i32(cell.w);
        for (var closure = 0; closure < closureCount; closure += 2) {
          let pair0 = heprClipTexel(clipTexture, closures + closure);
          let pair1 = heprClipTexel(clipTexture, closures + min(closure + 1, closureCount - 1));
          var below = heprClipClosuresBelow(pair0, sampleY);
          if (closure + 1 < closureCount) { below += heprClipClosuresBelow(pair1, sampleY); }
          below *= rows;
          winding0 -= below.x * columns;
          winding1 -= below.y * columns;
          winding2 -= below.z * columns;
          winding3 -= below.w * columns;
        }
      }
    }
  } else {
    let banded = (flags & 2) != 0;
    var bands = vec4<f32>(0.0);
    var bandOf = vec4<f32>(0.0);
    if (banded) {
      bands = heprClipTexel(clipTexture, i32(node.y));
      bandOf = clamp(floor((sampleY - bands.y) / bands.z), vec4<f32>(0.0), vec4<f32>(bands.w - 1.0));
    }
    for (var band = i32(bandOf.x); band <= i32(bandOf.w); band++) {
      var firstEdge = i32(node.y);
      var edgeCount = i32(node.z);
      if (banded) {
        let range = heprClipTexel(clipTexture, i32(bands.x) + band);
        firstEdge = i32(range.x);
        edgeCount = i32(range.y);
      }
      
      heprClipSampleEdges(clipTexture, firstEdge, edgeCount, sampleX, sampleY,
        heprClipMask(bandOf == vec4<f32>(f32(band))), vec4<f32>(1.0), &winding0, &winding1, &winding2, &winding3);
    }
  }
  let evenOdd = (flags & 1) != 0;
  return heprClipSampleGrid(heprClipSampleInside(winding0, evenOdd), heprClipSampleInside(winding1, evenOdd),
    heprClipSampleInside(winding2, evenOdd), heprClipSampleInside(winding3, evenOdd));
}
`+Md,Pd=`flat in float vVectorClipIndex;
`+jd.replaceAll(`int(uVectorClipIndex)`,`int(uVectorClipIndex < -1.5 ? vVectorClipIndex : uVectorClipIndex)`),Fd=`
uint heprRasterClipRectSamples(vec4 bounds, vec2 point) {
  bool inside = point.x >= bounds.x && point.y >= bounds.y && point.x < bounds.z && point.y < bounds.w;
  return inside ? 0xFFFFu : 0u;
}
`+jd.replace(`heprClipRectSamples(heprClipTexel(int(node.y)), sampleX, sampleY)`,`heprRasterClipRectSamples(heprClipTexel(int(node.y)), point)`).replace(`heprClipPolygonSamples(node, sampleX, sampleY, span);`,`heprRasterClipPolygonSamples(node, point, sampleX, sampleY, span);`).replace(`float heprVectorClipAA(vec2 point, float aaWidth)`,`
uint heprRasterClipPolygonSamples(vec4 node, vec2 point, vec4 sampleX, vec4 sampleY, float span) {
  bool tileRect = node.z == 4.0 && (int(node.w) & 6) == 0;
  if (tileRect) {
    for (int edge = 0; edge < 4; edge++) {
      vec4 line = heprClipTexel(int(node.y) + edge);
      tileRect = tileRect && min(abs(line.x - line.z), abs(line.y - line.w)) <= 0.002;
    }
  }
  if (tileRect) return heprClipPolygonSamples(node, vec4(point.x), vec4(point.y), 0.0);
  return heprClipPolygonSamples(node, sampleX, sampleY, span);
}
float heprVectorClipAA(vec2 point, float aaWidth)`),Id=Nd.replace(`heprClipRectSamples(heprClipTexel(clipTexture, i32(node.y)), sampleX, sampleY)`,`heprRasterClipRectSamples(heprClipTexel(clipTexture, i32(node.y)), point)`).replace(`heprClipPolygonSamples(clipTexture, node, sampleX, sampleY, span);`,`heprRasterClipPolygonSamples(clipTexture, node, point, sampleX, sampleY, span);`)+`
fn heprRasterClipRectSamples(bounds: vec4<f32>, point: vec2<f32>) -> u32 {
  let inside = point.x >= bounds.x && point.y >= bounds.y && point.x < bounds.z && point.y < bounds.w;
  return select(0u, 0xFFFFu, inside);
}

fn heprRasterClipPolygonSamples(clipTexture: texture_2d<f32>, node: vec4<f32>, point: vec2<f32>,
    sampleX: vec4<f32>, sampleY: vec4<f32>, span: f32) -> u32 {
  var tileRect = node.z == 4.0 && (i32(node.w) & 6) == 0;
  if (tileRect) {
    for (var edge = 0; edge < 4; edge++) {
      let line = heprClipTexel(clipTexture, i32(node.y) + edge);
      tileRect = tileRect && min(abs(line.x - line.z), abs(line.y - line.w)) <= 0.002;
    }
  }
  if (tileRect) { return heprClipPolygonSamples(clipTexture, node, vec4<f32>(point.x), vec4<f32>(point.y), 0.0); }
  return heprClipPolygonSamples(clipTexture, node, sampleX, sampleY, span);
}
`,Ld=`
vec4 heprThreeEncodeOutputColor(vec4 color) {
  
  
  return color;
}

float heprThreeLinearCoverageToOutputAlpha(float coverage) {
  return clamp(coverage, 0.0, 1.0);
}
`,Rd=`#version 300 es
precision highp float;
precision highp sampler2D;

layout(location = 0) in vec2 aCorner;
layout(location = 4) in float aVectorClipIndex;
flat out float vVectorClipIndex;
layout(location = 1) in float aSegmentIndex;

uniform sampler2D uSegmentTexA;
uniform sampler2D uSegmentTexB;
uniform sampler2D uSegmentStyleTex;
uniform sampler2D uSegmentBoundsTex;
uniform ivec2 uSegmentTexSize;
#ifdef HEPR_SPLIT_STROKE_STORE


uniform sampler2D uSegmentTailTexA;
uniform sampler2D uSegmentTailTexB;
uniform sampler2D uSegmentTailStyleTex;
uniform sampler2D uSegmentTailBoundsTex;
uniform ivec2 uSegmentTailTexSize;
uniform int uSegmentSplit;
#endif
uniform vec2 uViewport;
uniform vec2 uCameraCenter;
uniform float uZoom;
uniform float uAAScreenPx;
uniform float uUseLocalToClip;
uniform mat4 uLocalToClip;
uniform float uLocalUnitsPerPixel;

out vec2 vLocal;
flat out vec2 vP0;
flat out vec2 vP1;
flat out vec2 vP2;
flat out float vPrimitiveType;
flat out float vIsHairline;
flat out float vHalfWidth;
flat out float vAAWorld;
flat out vec3 vColor;
flat out float vAlpha;
flat out vec4 vClipBounds;
flat out float vHasClipBounds;

ivec2 segmentCoord(int index) {
  int x = index % uSegmentTexSize.x;
  int y = index / uSegmentTexSize.x;
  return ivec2(x, y);
}

void main() {
  vVectorClipIndex = aVectorClipIndex - 1.0;
  int index = int(aSegmentIndex + 0.5);
#ifdef HEPR_SPLIT_STROKE_STORE
  vec4 primitiveA;
  vec4 primitiveB;
  vec4 style;
  vec4 primitiveBounds;
  if (index >= uSegmentSplit) {
    int tailIndex = index - uSegmentSplit;
    ivec2 tailCoord = ivec2(tailIndex % uSegmentTailTexSize.x, tailIndex / uSegmentTailTexSize.x);
    primitiveA = texelFetch(uSegmentTailTexA, tailCoord, 0);
    primitiveB = texelFetch(uSegmentTailTexB, tailCoord, 0);
    style = texelFetch(uSegmentTailStyleTex, tailCoord, 0);
    primitiveBounds = texelFetch(uSegmentTailBoundsTex, tailCoord, 0);
  } else {
    primitiveA = texelFetch(uSegmentTexA, segmentCoord(index), 0);
    primitiveB = texelFetch(uSegmentTexB, segmentCoord(index), 0);
    style = texelFetch(uSegmentStyleTex, segmentCoord(index), 0);
    primitiveBounds = texelFetch(uSegmentBoundsTex, segmentCoord(index), 0);
  }
#else
  vec4 primitiveA = texelFetch(uSegmentTexA, segmentCoord(index), 0);
  vec4 primitiveB = texelFetch(uSegmentTexB, segmentCoord(index), 0);
  vec4 style = texelFetch(uSegmentStyleTex, segmentCoord(index), 0);
  vec4 primitiveBounds = texelFetch(uSegmentBoundsTex, segmentCoord(index), 0);
#endif

  vec2 p0 = primitiveA.xy;
  vec2 p1 = primitiveA.zw;
  vec2 p2 = primitiveB.xy;
  float primitiveType = primitiveB.z;
  bool isQuadratic = primitiveType >= 0.5;
  float halfWidth = style.x;
  vec3 color = style.yzw;
  float packedStyle = primitiveB.w;
  float styleFlags = floor(packedStyle / 2.0 + 1e-6);
  float alpha = packedStyle - styleFlags * 2.0;
  bool isHairline = mod(styleFlags, 2.0) >= 0.5;
  bool isRoundCap = mod(floor(styleFlags * 0.5), 2.0) >= 0.5;
  bool hasClipBounds = mod(floor(styleFlags * 0.25), 2.0) >= 0.5;

  float geometryLength = isQuadratic
    ? length(p1 - p0) + length(p2 - p1)
    : length(p2 - p0);

  if ((geometryLength == 0.0 && !isRoundCap) || alpha <= 0.001) {
    gl_Position = vec4(-2.0, -2.0, 0.0, 1.0);
    vLocal = vec2(0.0);
    vP0 = vec2(0.0);
    vP1 = vec2(0.0);
    vP2 = vec2(0.0);
    vPrimitiveType = 0.0;
    vIsHairline = 0.0;
    vHalfWidth = 0.0;
    vAAWorld = 1.0;
    vColor = color;
    vAlpha = 0.0;
    vClipBounds = vec4(0.0);
    vHasClipBounds = 0.0;
    return;
  }

  float localUnitsPerPixel = uUseLocalToClip >= 0.5
    ? max(uLocalUnitsPerPixel, 1e-6)
    : (1.0 / max(uZoom, 1e-4));
  if (isHairline) {
    halfWidth = max(0.5 * localUnitsPerPixel, 1e-5);
  }

  float aaWorld = max(localUnitsPerPixel, 0.0001) * uAAScreenPx;
  if (isHairline) {
    aaWorld = max(0.35 * localUnitsPerPixel, 5e-5);
  }

  float extent = halfWidth + aaWorld;
  vec2 corner01 = aCorner * 0.5 + 0.5;

  
  vec2 worldMin = primitiveBounds.xy - vec2(extent);
  vec2 worldMax = primitiveBounds.zw + vec2(extent);

  
  
  
  vec2 axisDelta = p2 - p0;
  float axisLength = length(axisDelta);
  vec2 axisU = axisLength > 1e-6 ? axisDelta / axisLength : vec2(1.0, 0.0);
  vec2 axisV = vec2(-axisU.y, axisU.x);
  vec2 controlOffset = p1 - p0;
  float controlU = dot(controlOffset, axisU);
  float controlV = dot(controlOffset, axisV);
  float orientedMinU = min(min(0.0, controlU), axisLength) - extent;
  float orientedMaxU = max(max(0.0, controlU), axisLength) + extent;
  float orientedMinV = min(0.0, controlV) - extent;
  float orientedMaxV = max(0.0, controlV) + extent;

  float axisAlignedArea = (worldMax.x - worldMin.x) * (worldMax.y - worldMin.y);
  float orientedArea = (orientedMaxU - orientedMinU) * (orientedMaxV - orientedMinV);

  vec2 worldPosition;
  if (orientedArea < axisAlignedArea) {
    worldPosition = p0
      + axisU * mix(orientedMinU, orientedMaxU, corner01.x)
      + axisV * mix(orientedMinV, orientedMaxV, corner01.y);
  } else {
    worldPosition = mix(worldMin, worldMax, corner01);
  }

  if (uUseLocalToClip >= 0.5) {
    gl_Position = uLocalToClip * vec4(worldPosition, 0.0, 1.0);
  } else {
    vec2 screen = (worldPosition - uCameraCenter) * uZoom + 0.5 * uViewport;
    vec2 clip = (screen / (0.5 * uViewport)) - 1.0;
    gl_Position = vec4(clip, 0.0, 1.0);
  }

  vLocal = worldPosition;
  vP0 = p0;
  vP1 = p1;
  vP2 = p2;
  vPrimitiveType = primitiveType;
  vIsHairline = isHairline ? 1.0 : 0.0;
  vHalfWidth = halfWidth;
  vAAWorld = aaWorld;
  vColor = color;
  vAlpha = alpha;
  vClipBounds = primitiveBounds;
  vHasClipBounds = hasClipBounds ? 1.0 : 0.0;
}
`,zd=`#version 300 es
precision highp float;
uniform float uStrokeCurveEnabled;
uniform float uAAScreenPx;
uniform vec4 uVectorOverride;
in vec2 vLocal;
flat in vec2 vP0;
flat in vec2 vP1;
flat in vec2 vP2;
flat in float vPrimitiveType;
flat in float vIsHairline;
flat in float vHalfWidth;
flat in vec3 vColor;
flat in float vAlpha;
flat in vec4 vClipBounds;
flat in float vHasClipBounds;

out vec4 outColor;

${Ld}

float distanceToLineSegment(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float abLenSq = dot(ab, ab);
  if (abLenSq <= 1e-10) {
    return length(p - a);
  }
  float t = clamp(dot(p - a, ab) / abLenSq, 0.0, 1.0);
  return length(p - (a + ab * t));
}

float distanceToQuadraticBezier(vec2 p, vec2 a, vec2 b, vec2 c) {
  vec2 aa = b - a;
  vec2 bb = a - 2.0 * b + c;
  vec2 cc = aa * 2.0;
  vec2 dd = a - p;

  float bbLenSq = dot(bb, bb);
  if (bbLenSq <= 1e-12) {
    return distanceToLineSegment(p, a, c);
  }

  float inv = 1.0 / bbLenSq;
  float kx = inv * dot(aa, bb);
  float ky = inv * (2.0 * dot(aa, aa) + dot(dd, bb)) / 3.0;
  float kz = inv * dot(dd, aa);

  float pValue = ky - kx * kx;
  float pCube = pValue * pValue * pValue;
  float qValue = kx * (2.0 * kx * kx - 3.0 * ky) + kz;
  float hValue = qValue * qValue + 4.0 * pCube;

  float best = 1e20;

  if (hValue >= 0.0) {
    float hSqrt = sqrt(hValue);
    vec2 roots = (vec2(hSqrt, -hSqrt) - qValue) * 0.5;
    vec2 uv = sign(roots) * pow(abs(roots), vec2(1.0 / 3.0));
    float t = clamp(uv.x + uv.y - kx, 0.0, 1.0);
    vec2 delta = dd + (cc + bb * t) * t;
    best = dot(delta, delta);
  } else {
    float z = sqrt(-pValue);
    float acosArg = clamp(qValue / (2.0 * pValue * z), -1.0, 1.0);
    float angle = acos(acosArg) / 3.0;
    float cosine = cos(angle);
    float sine = sin(angle) * 1.732050808;
    vec3 t = clamp(vec3(cosine + cosine, -sine - cosine, sine - cosine) * z - kx, 0.0, 1.0);

    vec2 delta = dd + (cc + bb * t.x) * t.x;
    best = min(best, dot(delta, delta));
    delta = dd + (cc + bb * t.y) * t.y;
    best = min(best, dot(delta, delta));
    delta = dd + (cc + bb * t.z) * t.z;
    best = min(best, dot(delta, delta));
  }

  return sqrt(max(best, 0.0));
}

${Pd}
${hd}
${vd}

void main() {
  if (vAlpha <= 0.001) {
    discard;
  }

  if (
    vHasClipBounds >= 0.5 &&
    (vLocal.x < vClipBounds.x || vLocal.y < vClipBounds.y || vLocal.x > vClipBounds.z || vLocal.y > vClipBounds.w)
  ) {
    discard;
  }

  float distanceToSegment = (uStrokeCurveEnabled >= 0.5 && vPrimitiveType >= 0.5)
    ? distanceToQuadraticBezier(vLocal, vP0, vP1, vP2)
    : distanceToLineSegment(vLocal, vP0, vP2);

  float pixelToLocalX = length(vec2(dFdx(vLocal.x), dFdy(vLocal.x)));
  float pixelToLocalY = length(vec2(dFdx(vLocal.y), dFdy(vLocal.y)));
  float localPerPixel = max(max(pixelToLocalX, pixelToLocalY), 1e-6);
  float aaWorld = max(localPerPixel * uAAScreenPx, 5e-5);
  float halfWidth = vIsHairline >= 0.5 ? max(0.5 * localPerPixel, 1e-5) : vHalfWidth;

  float coverage = heprStrokeCoverage(distanceToSegment, halfWidth, aaWorld);
  float alpha = heprThreeLinearCoverageToOutputAlpha(coverage) * vAlpha;
  alpha = heprStrokeLodAlpha(alpha, vPrimitiveType);

  if (alpha <= 0.0) {
    discard;
  }

  vec3 color = mix(vColor, uVectorOverride.rgb, clamp(uVectorOverride.a, 0.0, 1.0));
  outColor = heprThreeEncodeOutputColor(vec4(color, alpha));
  outColor *= heprVectorClip(vLocal);
}
`,Bd=`#version 300 es
precision highp float;



precision highp int;
precision highp sampler2D;

layout(location = 0) in vec2 aCorner;
layout(location = 4) in float aVectorClipIndex;
flat out float vVectorClipIndex;
layout(location = 3) in float aFillPathIndex;

uniform sampler2D uFillPathMetaTexA;
uniform sampler2D uFillPathMetaTexB;
uniform sampler2D uFillPathMetaTexC;
uniform ivec2 uFillPathMetaTexSize;


uniform sampler2D uFillSegmentTexA;
uniform ivec2 uFillSegmentTexSize;
uniform int uFillBandBase;


uniform int uFillCellHeaders;


uniform int uFillClipBoundsEnabled;
uniform highp sampler2D uFillClipBoundsTex;
uniform float uVectorClipIndex;
uniform vec2 uViewport;
uniform vec2 uCameraCenter;
uniform float uZoom;
uniform float uUseLocalToClip;
uniform mat4 uLocalToClip;

flat out int vSegmentStart;
flat out int vSegmentCount;

flat out vec4 vFillBands;

flat out vec4 vFillCells;
flat out vec2 vFillOrigin;
flat out vec3 vColor;
flat out float vAlpha;
flat out float vFillRule;
flat out float vFillHasCompanionStroke;
out vec2 vLocal;

ivec2 coordFromIndex(int index, ivec2 sizeValue) {
  int x = index % sizeValue.x;
  int y = index / sizeValue.x;
  return ivec2(x, y);
}

${Sd}

vec4 heprFillInstanceClipBounds(float instanceClipIndex) {
  int clipIndex = int(uVectorClipIndex < -1.5 ? instanceClipIndex : uVectorClipIndex);
  
  
  if (uUseLocalToClip < 0.5 && uFillClipBoundsEnabled > 0 && clipIndex >= 0) {
    return texelFetch(uFillClipBoundsTex,
      coordFromIndex(clipIndex, textureSize(uFillClipBoundsTex, 0)), 0);
  }
  return vec4(-1e38, -1e38, 1e38, 1e38);
}

vec4 heprFillQuadBounds(vec2 minBounds, vec2 maxBounds, vec2 margin, vec4 clipBounds) {
  
  if (clipBounds.x > clipBounds.z || clipBounds.y > clipBounds.w) {
    return vec4(1.0, 1.0, 0.0, 0.0);
  }
  return vec4(max(minBounds.x, clipBounds.x) - margin.x,
    max(minBounds.y, clipBounds.y) - margin.y,
    min(maxBounds.x, clipBounds.z) + margin.x,
    min(maxBounds.y, clipBounds.w) + margin.y);
}

void heprCullFill() {
  gl_Position = vec4(-2.0, -2.0, 0.0, 1.0);
  vSegmentStart = 0;
  vSegmentCount = 0;
  vFillBands = vec4(0.0);
  vFillCells = vec4(0.0);
  vFillOrigin = vec2(0.0);
  vColor = vec3(0.0);
  vAlpha = 0.0;
  vFillRule = 0.0;
  vFillHasCompanionStroke = 0.0;
  vLocal = vec2(0.0);
}

void main() {
  vVectorClipIndex = aVectorClipIndex - 1.0;
  int pathIndex = int(aFillPathIndex + 0.5);
  vec4 metaA = texelFetch(uFillPathMetaTexA, coordFromIndex(pathIndex, uFillPathMetaTexSize), 0);
  vec4 metaB = texelFetch(uFillPathMetaTexB, coordFromIndex(pathIndex, uFillPathMetaTexSize), 0);
  vec4 metaC = texelFetch(uFillPathMetaTexC, coordFromIndex(pathIndex, uFillPathMetaTexSize), 0);

  int segmentCount = int(metaA.y + 0.5);
  float alpha = metaC.w;
  if (segmentCount <= 0 || alpha <= 0.001) {
    heprCullFill();
    return;
  }

  vec2 minBounds = metaA.zw;
  vec2 maxBounds = metaB.xy;
  vec2 corner01 = aCorner * 0.5 + 0.5;
  
  
  vec2 margin = heprCoverageMargin(heprPathToPixel(mix(minBounds, maxBounds, corner01),
    uUseLocalToClip, uLocalToClip, uZoom, uViewport));
  margin = heprBoundCoverageMargin(mix(minBounds, maxBounds, corner01), margin, mat2(1.0),
    uUseLocalToClip, uLocalToClip, uViewport);
  vec4 quad = heprFillQuadBounds(minBounds, maxBounds, margin,
    heprFillInstanceClipBounds(vVectorClipIndex));
  if (quad.x > quad.z || quad.y > quad.w) {
    heprCullFill();
    return;
  }
  vec2 world = mix(quad.xy, quad.zw, corner01);

  if (uUseLocalToClip >= 0.5) {
    gl_Position = uLocalToClip * vec4(world, 0.0, 1.0);
  } else {
    vec2 screen = (world - uCameraCenter) * uZoom + 0.5 * uViewport;
    vec2 clip = (screen / (0.5 * uViewport)) - 1.0;
    gl_Position = vec4(clip, 0.0, 1.0);
  }

  vSegmentStart = int(metaA.x + 0.5);
  vSegmentCount = segmentCount;
  vFillBands = uFillBandBase < 0 ? vec4(0.0)
    : texelFetch(uFillSegmentTexA, coordFromIndex(uFillBandBase + pathIndex, uFillSegmentTexSize), 0);
  vFillCells = uFillCellHeaders <= 0 ? vec4(0.0)
    : texelFetch(uFillSegmentTexA, coordFromIndex(uFillCellHeaders - 1 + pathIndex, uFillSegmentTexSize), 0);
  vFillOrigin = minBounds;
  vColor = vec3(metaB.z, metaB.w, metaC.z);
  vAlpha = alpha;
  vFillRule = metaC.x;
  vFillHasCompanionStroke = metaC.y;
  vLocal = world;
}
`,Vd=`#version 300 es
precision highp float;



precision highp int;
precision highp sampler2D;

uniform sampler2D uFillSegmentTexA;
uniform sampler2D uFillSegmentTexB;
uniform ivec2 uFillSegmentTexSize;
uniform float uFillAAScreenPx;
uniform vec4 uVectorOverride;
uniform int uFillBandEntries;

flat in int vSegmentStart;
flat in int vSegmentCount;
flat in vec4 vFillBands;
flat in vec4 vFillCells;
flat in vec2 vFillOrigin;
flat in vec3 vColor;
flat in float vAlpha;
flat in float vFillRule;
in vec2 vLocal;

out vec4 outColor;

${Ld}

const float FILL_PRIMITIVE_QUADRATIC = 1.0;

ivec2 coordFromIndex(int index, ivec2 sizeValue) {
  int x = index % sizeValue.x;
  int y = index / sizeValue.x;
  return ivec2(x, y);
}

${bd}

vec4 heprCellFetchA(int index) {
  return texelFetch(uFillSegmentTexA, coordFromIndex(index, uFillSegmentTexSize), 0);
}

vec4 heprCellFetchB(int index) {
  return texelFetch(uFillSegmentTexB, coordFromIndex(index, uFillSegmentTexSize), 0);
}

${Ed}

${Pd}

void main() {
  
  vec2 footprint = max(vec2(
    length(vec2(dFdx(vLocal.x), dFdy(vLocal.x))),
    length(vec2(dFdx(vLocal.y), dFdy(vLocal.y)))
  ) * uFillAAScreenPx, vec2(1e-4));
  if (vSegmentCount <= 0 || vAlpha <= 0.001) {
    discard;
  }

  
  
  
  
  
  vec4 box = vec4(vLocal - 0.5 * footprint, 1.0 / footprint);
  float winding = 0.0;
  if (vFillCells.y > 0.0) {
    
    winding = heprCellWinding(vFillCells, vFillOrigin, box, footprint);
  } else {
    int bandCount = int(vFillBands.y);
    int firstBand = 0;
    int lastBand = 0;
    if (bandCount > 0) {
      float bandHeight = vFillBands.w;
      firstBand = clamp(int(floor((box.y - vFillBands.z) / bandHeight)), 0, bandCount - 1);
      lastBand = clamp(int(floor((box.y + footprint.y - vFillBands.z) / bandHeight)), 0, bandCount - 1);
    }

    for (int band = firstBand; band <= lastBand; band += 1) {
      int count = vSegmentCount;
      int entry = 0;
      if (bandCount > 0) {
        vec4 range = texelFetch(uFillSegmentTexA,
          coordFromIndex(int(vFillBands.x) + band, uFillSegmentTexSize), 0);
        entry = int(range.x);
        count = int(range.y);
      }
      vec2 rows = heprBandRows(vFillBands, band, bandCount, box);
      for (int i = 0; i < count; i += 1) {
        int segment = vSegmentStart + i;
        if (bandCount > 0) {
          int packedIndex = entry + i;
          vec4 packed = texelFetch(uFillSegmentTexA,
            coordFromIndex(uFillBandEntries + (packedIndex >> 2), uFillSegmentTexSize), 0);
          segment = int(packed[packedIndex & 3]);
        }
        vec4 primitiveA = texelFetch(uFillSegmentTexA, coordFromIndex(segment, uFillSegmentTexSize), 0);
        vec4 primitiveB = texelFetch(uFillSegmentTexB, coordFromIndex(segment, uFillSegmentTexSize), 0);
        winding += heprSegmentCoverage(primitiveA.xy, primitiveA.zw, primitiveB.xy,
          primitiveB.z >= FILL_PRIMITIVE_QUADRATIC, box, rows.x, rows.y);
      }
    }
  }

  vec3 color = mix(vColor, uVectorOverride.rgb, clamp(uVectorOverride.a, 0.0, 1.0));
  
  
  float coverage = heprFillCoverage(winding, vFillRule >= 0.5);
  float alpha = heprThreeLinearCoverageToOutputAlpha(coverage) * vAlpha;
  if (alpha <= 0.001) {
    discard;
  }

  outColor = heprThreeEncodeOutputColor(vec4(color, alpha));
  outColor *= heprVectorClip(vLocal);
}
`,Hd=`#version 300 es
precision highp float;
precision highp sampler2D;

layout(location = 0) in vec2 aCorner;
layout(location = 4) in float aVectorClipIndex;
flat out float vVectorClipIndex;
layout(location = 2) in float aTextInstanceIndex;

uniform sampler2D uTextInstanceTexA;
uniform sampler2D uTextInstanceTexB;
uniform sampler2D uTextInstanceTexC;
uniform sampler2D uTextGlyphMetaTexA;
uniform sampler2D uTextGlyphMetaTexB;
uniform sampler2D uTextGlyphRasterMetaTex;
uniform ivec2 uTextInstanceTexSize;
uniform ivec2 uTextGlyphMetaTexSize;
uniform vec2 uViewport;
uniform vec2 uCameraCenter;
uniform float uZoom;
uniform float uUseLocalToClip;
uniform mat4 uLocalToClip;
uniform float uTextVectorOnly;

flat out int vSegmentStart;
flat out int vSegmentCount;
flat out vec3 vColor;
flat out float vColorAlpha;
flat out vec4 vRasterRect;
flat out float vInkDensity;
out vec2 vNormCoord;
out vec2 vLocal;
out vec2 vWorld;
flat out vec4 vClipRect;

ivec2 coordFromIndex(int index, ivec2 sizeValue) {
  int x = index % sizeValue.x;
  int y = index / sizeValue.x;
  return ivec2(x, y);
}

${Sd}

void main() {
  vVectorClipIndex = aVectorClipIndex - 1.0;
  int instanceIndex = int(aTextInstanceIndex + 0.5);
  vec4 instanceA = texelFetch(uTextInstanceTexA, coordFromIndex(instanceIndex, uTextInstanceTexSize), 0);
  vec4 instanceB = texelFetch(uTextInstanceTexB, coordFromIndex(instanceIndex, uTextInstanceTexSize), 0);
  vec4 instanceC = texelFetch(uTextInstanceTexC, coordFromIndex(instanceIndex, uTextInstanceTexSize), 0);

  int glyphIndex = int(instanceB.z + 0.5);
  vec4 glyphMetaA = texelFetch(uTextGlyphMetaTexA, coordFromIndex(glyphIndex, uTextGlyphMetaTexSize), 0);
  vec4 glyphMetaB = texelFetch(uTextGlyphMetaTexB, coordFromIndex(glyphIndex, uTextGlyphMetaTexSize), 0);

  int segmentCount = int(glyphMetaA.y + 0.5);
  if (segmentCount <= 0) {
    gl_Position = vec4(-2.0, -2.0, 0.0, 1.0);
    vSegmentStart = 0;
    vSegmentCount = 0;
    vColor = vec3(0.0);
    vColorAlpha = 0.0;
    vRasterRect = vec4(0.0);
    vInkDensity = 0.0;
    vNormCoord = vec2(0.0);
    vLocal = vec2(0.0);
    vWorld = vec2(0.0);
    vClipRect = vec4(0.0);
    return;
  }

  
  
  vec4 glyphRasterMeta = vec4(0.0);
  if (uTextVectorOnly < 0.5) {
    glyphRasterMeta = texelFetch(uTextGlyphRasterMetaTex, coordFromIndex(glyphIndex, uTextGlyphMetaTexSize), 0);
  }

  vec2 minBounds = glyphMetaA.zw;
  vec2 maxBounds = glyphMetaB.xy;
  vec2 corner01 = aCorner * 0.5 + 0.5;
  
  
  mat2 glyphToWorld = mat2(instanceA.x, instanceA.y, instanceA.z, instanceA.w);
  vec2 cornerWorld = glyphToWorld * mix(minBounds, maxBounds, corner01) + instanceB.xy;
  mat2 glyphToPixel = heprPathToPixel(cornerWorld, uUseLocalToClip, uLocalToClip, uZoom, uViewport) * glyphToWorld;
  vec2 margin = heprCoverageMargin(glyphToPixel);
  margin = heprBoundCoverageMarginFromPixel(cornerWorld, margin, glyphToWorld, glyphToPixel, uUseLocalToClip, uLocalToClip);
  vec2 local = mix(minBounds - margin, maxBounds + margin, corner01);

  vec2 world = vec2(
    instanceA.x * local.x + instanceA.z * local.y + instanceB.x,
    instanceA.y * local.x + instanceA.w * local.y + instanceB.y
  );
  int clipRef = int(instanceB.w + 0.5);
  vClipRect = clipRef > 0
    ? texelFetch(uTextGlyphMetaTexA, coordFromIndex(clipRef - 1, uTextGlyphMetaTexSize), 0)
    : vec4(0.0);

  if (uUseLocalToClip >= 0.5) {
    gl_Position = uLocalToClip * vec4(world, 0.0, 1.0);
  } else {
    vec2 screen = (world - uCameraCenter) * uZoom + 0.5 * uViewport;
    vec2 clip = (screen / (0.5 * uViewport)) - 1.0;
    gl_Position = vec4(clip, 0.0, 1.0);
  }
  vSegmentStart = int(glyphMetaA.x + 0.5);
  vSegmentCount = segmentCount;
  vColor = instanceC.rgb;
  vColorAlpha = instanceC.a;
  vRasterRect = glyphRasterMeta;
  vInkDensity = glyphMetaB.z;
  
  vNormCoord = (local - minBounds) / max(maxBounds - minBounds, vec2(1e-6));
  vLocal = local;
  vWorld = world;
}
`,Ud=`#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uTextGlyphSegmentTexA;
uniform sampler2D uTextGlyphSegmentTexB;
uniform sampler2D uTextRasterAtlasTex;
uniform ivec2 uTextGlyphSegmentTexSize;
uniform vec2 uTextRasterAtlasSize;
uniform float uTextAAScreenPx;
uniform float uTextCurveEnabled;
uniform float uTextVectorOnly;
uniform vec4 uVectorOverride;

flat in int vSegmentStart;
flat in int vSegmentCount;
flat in vec3 vColor;
flat in vec4 vClipRect;
in vec2 vWorld;
flat in float vColorAlpha;
flat in vec4 vRasterRect;
flat in float vInkDensity;
in vec2 vNormCoord;
in vec2 vLocal;

out vec4 outColor;

${Ld}

const float TEXT_PRIMITIVE_QUADRATIC = 1.0;

ivec2 coordFromIndex(int index, ivec2 sizeValue) {
  int x = index % sizeValue.x;
  int y = index / sizeValue.x;
  return ivec2(x, y);
}

${bd}

${Pd}

void main() {
  if (vClipRect.z > vClipRect.x && vClipRect.w > vClipRect.y &&
      (vWorld.x < vClipRect.x || vWorld.y < vClipRect.y ||
       vWorld.x > vClipRect.z || vWorld.y > vClipRect.w)) {
    discard;
  }
  vec2 localDx = dFdx(vLocal);
  vec2 localDy = dFdy(vLocal);
  float pixelToLocalX = length(vec2(localDx.x, localDy.x));
  float pixelToLocalY = length(vec2(localDx.y, localDy.y));
  vec2 glyphPixel = vec2(
    length(vec2(dFdx(vNormCoord.x), dFdy(vNormCoord.x))),
    length(vec2(dFdx(vNormCoord.y), dFdy(vNormCoord.y)))
  );
  vec2 atlasPxSize = max(uTextRasterAtlasSize, vec2(1.0));
  vec2 nc = vec2(vNormCoord.x, 1.0 - vNormCoord.y) * (vRasterRect.zw * atlasPxSize);
  vec2 dncDx = dFdx(nc);
  vec2 dncDy = dFdy(nc);
  float ncFwidthX = abs(dncDx.x) + abs(dncDy.x);
  float ncFwidthY = abs(dncDx.y) + abs(dncDy.y);

  if (vSegmentCount <= 0) {
    discard;
  }

  
  
  
  float glyphPixels = 1.0 / max(min(glyphPixel.x, glyphPixel.y), 1e-6);
  float detail = clamp((glyphPixels - 2.5) / 2.5, 0.0, 1.0);
  vec2 halfBox = max(0.5 * uTextAAScreenPx * glyphPixel, vec2(1e-6));
  vec2 boxOverlap = max(min(vNormCoord + halfBox, vec2(1.0)) - max(vNormCoord - halfBox, vec2(0.0)), vec2(0.0)) /
    (2.0 * halfBox);
  float coverage = clamp(vInkDensity, 0.0, 1.0) * boxOverlap.x * boxOverlap.y;

  if (detail > 0.0) {
    float detailCoverage = 0.0;
    if (
      uTextVectorOnly < 0.5 &&
      vRasterRect.z > 0.0 &&
      vRasterRect.w > 0.0 &&
      min(ncFwidthX, ncFwidthY) > 2.0
    ) {
      vec2 uvCenter = vec2(
        vRasterRect.x + vNormCoord.x * vRasterRect.z,
        vRasterRect.y + (1.0 - vNormCoord.y) * vRasterRect.w
      );
      vec2 texel = 1.0 / atlasPxSize;
      
      
      vec2 padding = texel * 7.5;
      vec2 uvMin = vRasterRect.xy - padding;
      vec2 uvMax = vRasterRect.xy + vRasterRect.zw + padding;
      vec2 tapDx = dncDx * 0.33 * texel;
      vec2 tapDy = dncDy * 0.33 * texel;
      
      
      vec2 mipBiasedUvDx = dncDx * texel * 0.42044820762685725;
      vec2 mipBiasedUvDy = dncDy * texel * 0.42044820762685725;
      
      float mipCap = min(1.0, 8.0 /
        max(max(length(dncDx), length(dncDy)) * 0.42044820762685725, 1e-6));
      mipBiasedUvDx *= mipCap;
      mipBiasedUvDy *= mipCap;
      detailCoverage = (1.0 / 3.0) * textureGrad(
        uTextRasterAtlasTex,
        clamp(uvCenter, uvMin, uvMax),
        mipBiasedUvDx,
        mipBiasedUvDy
      ).r +
        (1.0 / 6.0) * (
          textureGrad(uTextRasterAtlasTex, clamp(uvCenter - tapDx - tapDy, uvMin, uvMax), mipBiasedUvDx, mipBiasedUvDy).r +
          textureGrad(uTextRasterAtlasTex, clamp(uvCenter - tapDx + tapDy, uvMin, uvMax), mipBiasedUvDx, mipBiasedUvDy).r +
          textureGrad(uTextRasterAtlasTex, clamp(uvCenter + tapDx - tapDy, uvMin, uvMax), mipBiasedUvDx, mipBiasedUvDy).r +
          textureGrad(uTextRasterAtlasTex, clamp(uvCenter + tapDx + tapDy, uvMin, uvMax), mipBiasedUvDx, mipBiasedUvDy).r
        );
    } else {
      
      
      vec2 footprint = max(vec2(pixelToLocalX, pixelToLocalY) * uTextAAScreenPx, vec2(1e-4));
      vec4 box = vec4(vLocal - 0.5 * footprint, 1.0 / footprint);
      float winding = 0.0;
      for (int i = 0; i < vSegmentCount; i += 1) {
        vec4 primitiveA = texelFetch(uTextGlyphSegmentTexA, coordFromIndex(vSegmentStart + i, uTextGlyphSegmentTexSize), 0);
        vec4 primitiveB = texelFetch(uTextGlyphSegmentTexB, coordFromIndex(vSegmentStart + i, uTextGlyphSegmentTexSize), 0);
        winding += heprSegmentCoverage(primitiveA.xy, primitiveA.zw, primitiveB.xy,
          uTextCurveEnabled >= 0.5 && primitiveB.z >= TEXT_PRIMITIVE_QUADRATIC, box, 0.0, 1.0);
      }
      detailCoverage = heprFillCoverage(winding, false);
    }
    coverage = mix(coverage, detailCoverage, detail);
  }

  float alpha = heprThreeLinearCoverageToOutputAlpha(coverage) * vColorAlpha;
  if (alpha <= 0.001) {
    discard;
  }

  vec3 color = mix(vColor, uVectorOverride.rgb, clamp(uVectorOverride.a, 0.0, 1.0));
  outColor = heprThreeEncodeOutputColor(vec4(color, alpha));
  outColor *= heprVectorClip(vWorld);
}
`,Wd=`#version 300 es
precision highp float;

layout(location = 0) in vec2 aCorner;

void main() {
  gl_Position = vec4(aCorner, 0.0, 1.0);
}
`,Gd=`#version 300 es
precision highp float;

uniform sampler2D uVectorLayerTex;
uniform vec2 uViewportPx;

out vec4 outColor;

void main() {
  vec2 uv = gl_FragCoord.xy / max(uViewportPx, vec2(1.0));
  outColor = texture(uVectorLayerTex, clamp(uv, vec2(0.0), vec2(1.0)));
}
`,Kd=`#version 300 es
precision highp float;

layout(location = 0) in vec2 aCorner;

#ifdef INSTANCED_PAGE_BACKGROUNDS
layout(location = 1) in vec4 aPageRect;
#else
uniform vec4 uRasterMatrixABCD;
uniform vec2 uRasterMatrixEF;


uniform vec4 uRasterQuad;
uniform vec4 uRasterUv;
#endif
uniform vec2 uViewport;
uniform vec2 uCameraCenter;
uniform float uZoom;
uniform float uUseLocalToClip;
uniform mat4 uLocalToClip;

out vec2 vUv;
out vec2 vWorld;

void main() {
  vec2 corner01 = aCorner * 0.5 + 0.5;
  vec2 localTopDown = vec2(corner01.x, 1.0 - corner01.y);
  vec2 uv = localTopDown;

#ifdef INSTANCED_PAGE_BACKGROUNDS
  vec2 world = aPageRect.xy + aPageRect.zw * localTopDown;
#else
  float a = uRasterMatrixABCD.x;
  float b = uRasterMatrixABCD.y;
  float c = uRasterMatrixABCD.z;
  float d = uRasterMatrixABCD.w;
  float e = uRasterMatrixEF.x;
  float f = uRasterMatrixEF.y;

  bool wholeImage = uRasterQuad == vec4(0.0);
  vec4 quad = wholeImage ? vec4(0.0, 0.0, 1.0, 1.0) : uRasterQuad;
  vec4 tileUv = wholeImage ? vec4(0.0, 0.0, 1.0, 1.0) : uRasterUv;
  
  bvec2 farCorner = greaterThan(localTopDown, vec2(0.5));
  vec2 tileCorner = mix(quad.xy, quad.zw, farCorner);
  uv = mix(tileUv.xy, tileUv.zw, farCorner);

  vec2 world = vec2(
    a * tileCorner.x + c * tileCorner.y + e,
    b * tileCorner.x + d * tileCorner.y + f
  );
#endif

  if (uUseLocalToClip >= 0.5) {
    gl_Position = uLocalToClip * vec4(world, 0.0, 1.0);
  } else {
    vec2 screen = (world - uCameraCenter) * uZoom + 0.5 * uViewport;
    vec2 clip = (screen / (0.5 * uViewport)) - 1.0;
    gl_Position = vec4(clip, 0.0, 1.0);
  }
  vWorld = world;
  vUv = uv;
}
`,qd=`#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uRasterTex;
uniform float uRasterOpacity;
in vec2 vUv;
in vec2 vWorld;
out vec4 outColor;

${Fd}

void main() {
  
  
  float clipAAWidth = max(max(length(vec2(dFdx(vWorld.x), dFdy(vWorld.x))),
    length(vec2(dFdx(vWorld.y), dFdy(vWorld.y)))), 1e-4);
  vec4 color = texture(uRasterTex, vUv) * uRasterOpacity;
  if (color.a <= 0.001) {
    discard;
  }
  outColor = color;
  outColor *= heprVectorClipAA(vWorld, clipAAWidth);
}
`,Jd=`#version 300 es
precision highp float;

layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aRectBounds;

uniform vec2 uViewport;
uniform vec2 uCameraCenter;


uniform float uZoom;
uniform float uUseLocalToClip;
uniform mat4 uLocalToClip;
uniform float uBorderPx;
uniform float uMinSizePx;

out vec2 vLocalPx;
out vec2 vHalfSizePx;

void main() {
  vec2 center = (aRectBounds.xy + aRectBounds.zw) * 0.5;
  vec2 halfSize = (aRectBounds.zw - aRectBounds.xy) * 0.5;
  vec2 halfSizePx = max(halfSize * uZoom, vec2(0.5 * uMinSizePx));
  vec2 expandedHalfPx = halfSizePx + vec2(uBorderPx);
  vec2 world = center + aCorner * (expandedHalfPx / uZoom);

  vLocalPx = aCorner * expandedHalfPx;
  vHalfSizePx = halfSizePx;

  if (uUseLocalToClip >= 0.5) {
    gl_Position = uLocalToClip * vec4(world, 0.0, 1.0);
  } else {
    vec2 screen = (world - uCameraCenter) * uZoom + 0.5 * uViewport;
    vec2 clip = (screen / (0.5 * uViewport)) - 1.0;
    gl_Position = vec4(clip, 0.0, 1.0);
  }
}
`,Yd=`#version 300 es
precision highp float;

in vec2 vLocalPx;
in vec2 vHalfSizePx;

uniform vec4 uFillColor;
uniform vec4 uBorderColor;

out vec4 outColor;

void main() {
  vec2 distanceToEdgePx = vHalfSizePx - abs(vLocalPx);
  bool insideRect = distanceToEdgePx.x >= 0.0 && distanceToEdgePx.y >= 0.0;
  outColor = insideRect ? uFillColor : uBorderColor;
}
`;function Xd(e,t){for(let[n,r]of t)if(!Number.isSafeInteger(n)||n<0||n>=e.rasterLayers.length||!Number.isSafeInteger(r.width)||!Number.isSafeInteger(r.height)||r.width<1||r.height<1||!Number.isSafeInteger(r.width*r.height*4)||r.opacity!==void 0&&(!Number.isFinite(r.opacity)||r.opacity<0||r.opacity>1)||r.data.length!==r.width*r.height*4||r.matrix.length!==6||!r.matrix.every(Number.isFinite))throw RangeError(`Invalid raster replacement.`)}var Zd=1024,Qd=512,$d=16777216,ef=4;function tf(e,t,n=`box`){if(!e.drawRuns||e.paintGraph||e.retainedPages?.length||!Number.isFinite(t)||t<ef)return[];let r=Math.min(Zd,Math.floor(t/2)),i=Math.min(Qd,Math.floor(t)),a=[],o=$d,s=new Set;for(let t of e.drawRuns){if(t.kind!==`raster`||t.blendMode)continue;let c=Math.min(e.rasterLayers.length,t.first+t.count),l=t.first;for(;l<c;){if(s.has(l)||!nf(e.rasterLayers[l],r)){l++;continue}let t=0,u=0;for(;l+t<c&&t<i&&!s.has(l+t);){let n=e.rasterLayers[l+t];if(!nf(n,r))break;let i=Math.max(u,n.width*2);if((i*4+32)*(t+1)>o)break;u=i,t++}if(t>=ef){let r=new Uint8Array(u*t*4),i=new Float32Array(t*8);for(let a=0;a<t;a++){let t=e.rasterLayers[l+a];i.set(t.matrix.subarray(0,6),a*8),i[a*8+6]=t.width,i[a*8+7]=t.opacity??1,rf(r,a*u*4,t,n),s.add(l+a)}a.push({first:l,count:t,width:u,height:t,data:r,instances:i}),o-=r.byteLength+i.byteLength}l+=Math.max(1,t)}}return a}function nf(e,t){return!!e&&e.height===1&&Number.isInteger(e.width)&&e.width>0&&e.width<=t&&e.data instanceof Uint8Array&&e.data.length>=e.width*4&&e.matrix instanceof Float32Array&&e.matrix.length>=6&&e.matrix.subarray(0,6).every(Number.isFinite)&&Number.isFinite(e.opacity??1)&&(e.opacity??1)>=0&&(e.opacity??1)<=1}function rf(e,t,n,r){let i=n.width;for(let r=0;r<i;r++){let i=r*4,a=n.data[i+3];for(let r=0;r<3;r++)e[t+i+r]=Math.round(n.data[i+r]*a/255);e[t+i+3]=a}for(;i>1;){let n=Math.floor(i/2),a=t+i*4,o=r===`linear`?n*2:2;for(let s=0;s<n;s++){let c=r===`linear`?(s*2+1)*i-n:s*4+1,l=Math.floor(c/o),u=c-l*o;for(let n=0;n<4;n++)e[a+s*4+n]=Math.floor((e[t+l*4+n]*(o-u)+e[t+(l+1)*4+n]*u+o/2)/o)}t=a,i=n}}var af=64,of=16,sf=[0,0,1,1];function cf(e,t,n){let r=Math.floor(n);if(!(r>=16)||e<=r&&t<=r)return{width:e,height:t,tiles:[{x:0,y:0,width:e,height:t,quad:sf,uv:sf}]};let i=1;for(;i*2<=Math.min(af,r/8);)i*=2;let a=Math.floor((r-2*i)/i)*i,o=e,s=t,c=r*r;if(o*s>c){let e=Math.sqrt(c/(o*s));o=Math.max(1,Math.floor(o*e)),s=Math.max(1,Math.floor(s*e))}o=Math.min(o,a*of),s=Math.min(s,a*of);let l=lf(o,r,a,i),u=lf(s,r,a,i),d=[];for(let e of u)for(let t of l){let n=t.textureEnd-t.textureStart,r=e.textureEnd-e.textureStart;d.push({x:t.textureStart,y:e.textureStart,width:n,height:r,quad:[t.start/o,e.start/s,t.end/o,e.end/s],uv:[(t.start-t.textureStart)/n,(e.start-e.textureStart)/r,(t.end-t.textureStart)/n,(e.end-e.textureStart)/r]})}return{width:o,height:s,tiles:d}}function lf(e,t,n,r){if(e<=t)return[{start:0,end:e,textureStart:0,textureEnd:e}];let i=[];for(let t=0;t<e;t+=n){let a=Math.min(e,t+n);i.push({start:t,end:a,textureStart:Math.max(0,t-r),textureEnd:Math.min(e,a+r)})}return i}function uf(e,t){return e.width===t.width&&e.height===t.height&&e.tiles.length===t.tiles.length&&e.tiles.every((e,n)=>{let r=t.tiles[n];return e.x===r.x&&e.y===r.y&&e.width===r.width&&e.height===r.height})}function df(e,t){return t.width!==e.width||t.height!==e.height}function ff(e,t){let n=df(e,t),r=n?mf(e.data,e.width,e.height,t.width,t.height):e.data;return t.tiles.map(e=>{if(n&&e.width===t.width&&e.height===t.height)return r;let i=new Uint8Array(e.width*e.height*4);for(let a=0;a<e.height;a++){let o=((e.y+a)*t.width+e.x)*4,s=r.subarray(o,o+e.width*4);n?i.set(s,a*e.width*4):pf(i,a*e.width*4,s)}return i})}function pf(e,t,n){for(let r=0;r+3<n.length;r+=4){let i=n[r+3];if(i<=0)continue;if(i>=255){e[t+r]=n[r],e[t+r+1]=n[r+1],e[t+r+2]=n[r+2],e[t+r+3]=255;continue}let a=i/255;e[t+r]=Math.round(n[r]*a),e[t+r+1]=Math.round(n[r+1]*a),e[t+r+2]=Math.round(n[r+2]*a),e[t+r+3]=i}}function mf(e,t,n,r,i){let a=new Uint8Array(r*i*4),o=new Float64Array(t*4),s=t/r,c=n/i,l=s*c;for(let u=0;u<i;u++){o.fill(0);let i=u*c,d=i+c;for(let r=Math.floor(i);r<Math.min(n,Math.ceil(d));r++){let n=Math.min(d,r+1)-Math.max(i,r);if(!(n<=0))for(let i=0,a=r*t*4;i<t;i++,a+=4){let t=e[a+3]*n,r=t/255;o[i*4]+=e[a]*r,o[i*4+1]+=e[a+1]*r,o[i*4+2]+=e[a+2]*r,o[i*4+3]+=t}}for(let e=0;e<r;e++){let n=e*s,i=n+s,c=0,d=0,f=0,p=0;for(let e=Math.floor(n);e<Math.min(t,Math.ceil(i));e++){let t=Math.min(i,e+1)-Math.max(n,e);t<=0||(c+=o[e*4]*t,d+=o[e*4+1]*t,f+=o[e*4+2]*t,p+=o[e*4+3]*t)}let m=(u*r+e)*4;a[m]=Math.min(255,Math.round(c/l)),a[m+1]=Math.min(255,Math.round(d/l)),a[m+2]=Math.min(255,Math.round(f/l)),a[m+3]=Math.min(255,Math.round(p/l))}}return a}var hf=new WeakSet;function gf(e,t,n,r){df(t,n)&&!hf.has(t.data)&&(hf.add(t.data),console.warn(`[HEPR] Raster image ${e} (${t.width}x${t.height}) needs more GPU memory than this device's ${r}x${r} texture limit allows for one image; drawing it at ${n.width}x${n.height}.`))}var _f=`#version 300 es
precision highp float;

layout(location = 0) in vec4 aRasterMatrixABCD;
layout(location = 1) in vec4 aRasterMatrixEFWidthOpacity;
uniform vec2 uViewport;
uniform vec2 uCameraCenter;
uniform float uZoom;
uniform float uUseLocalToClip;
uniform mat4 uLocalToClip;
out vec2 vUv;
out vec2 vWorld;
flat out float vWidth;
flat out float vOpacity;
flat out float vRow;

void main() {
  vec2 uv = vec2(float(gl_VertexID & 1), float(1 - (gl_VertexID >> 1)));
  vec2 world = vec2(
    aRasterMatrixABCD.x * uv.x + aRasterMatrixABCD.z * uv.y + aRasterMatrixEFWidthOpacity.x,
    aRasterMatrixABCD.y * uv.x + aRasterMatrixABCD.w * uv.y + aRasterMatrixEFWidthOpacity.y
  );
  if (uUseLocalToClip >= 0.5) {
    gl_Position = uLocalToClip * vec4(world, 0.0, 1.0);
  } else {
    vec2 screen = (world - uCameraCenter) * uZoom + 0.5 * uViewport;
    gl_Position = vec4(screen / (0.5 * uViewport) - 1.0, 0.0, 1.0);
  }
  vUv = uv;
  vWorld = world;
  vWidth = aRasterMatrixEFWidthOpacity.z;
  vOpacity = aRasterMatrixEFWidthOpacity.w;
  vRow = float(gl_InstanceID);
}
`,vf=`#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uRasterStripTex;
uniform vec2 uRasterStripSize;
in vec2 vUv;
in vec2 vWorld;
flat in float vWidth;
flat in float vOpacity;
flat in float vRow;
out vec4 outColor;

${Fd}

vec4 sampleStripLevel(float level) {
  float offset = 0.0;
  float width = vWidth;
  
  for (int step = 0; step < 10; step++) {
    if (float(step) >= level) break;
    offset += width;
    width = max(1.0, floor(width * 0.5));
  }
  vec2 texel = vec2(offset + clamp(vUv.x * width, 0.5, width - 0.5), vRow + 0.5);
  return textureLod(uRasterStripTex, texel / uRasterStripSize, 0.0);
}

void main() {
  
  float clipAAWidth = max(max(length(vec2(dFdx(vWorld.x), dFdy(vWorld.x))),
    length(vec2(dFdx(vWorld.y), dFdy(vWorld.y)))), 1e-4);
  vec2 sourcePixels = vUv * vec2(vWidth, 1.0);
  float footprint = max(length(dFdx(sourcePixels)), length(dFdy(sourcePixels)));
  int remaining = int(vWidth);
  int maxLevel = 0;
  for (int step = 0; step < 10; step++) {
    if (remaining < 2) break;
    remaining /= 2;
    maxLevel++;
  }
  float lod = clamp(log2(max(footprint, 1.0)), 0.0, float(maxLevel));
  float lower = floor(lod);
  vec4 color = mix(sampleStripLevel(lower), sampleStripLevel(ceil(lod)), fract(lod)) * vOpacity;
  if (color.a <= 0.001) discard;
  outColor = color * heprVectorClipAA(vWorld, clipAAWidth);
}
`;function yf(e,t,n,r,i,a,o,s,c){if(!r)return null;let l=r({minX:0,minY:0,maxX:1,maxY:1});if(!l)return null;let u=i/o,d=a/s,f=c?-1:1;return Cf(e,t,n,[l.width*u,0,l.x*u,0,l.height*d*f,c?a-l.y*d:l.y*d,0,0,1])}var bf=7,xf=256;function Sf(e,t,n){for(let r=t??-1,i=0;r>=0&&i<xf;i++){if(r===n)return!0;r=e.clipPaths?.[r]?.parent??-1}return!1}function Cf(e,t,n,r){let i=t.first,a=e.gradientFillPaintMeta,o=e.gradientFillPathMetaA;if(t.kind!==`gradient-fill`||t.count!==1||!a||!o||!e.gradientFillPathMetaC||i<0||i*4+3>=a.length)return null;let s=a[i*4],c=s*4;if(!(s>=0&&s<e.gradientCount)||a[i*4+1]>=0)return null;let{gradientMetaA:l,gradientMetaB:u,gradientMetaC:d,gradientMetaD:f,gradientMetaE:p}=e;if(!l||!u||!d||!f||!p||c+3>=l.length||l[c]>1.5)return null;let m=[],h=[],g=e.gradientFillSegmentsA,_=e.gradientFillSegmentsB;for(let e=o[i*4],t=e+o[i*4+1];e<t;e++){let t=e*4;if(!g||!_||t+3>=g.length||_[t+2]>=1)return null;h.push(g[t],g[t+1],_[t],_[t+1])}m.push(h);let v=t.clipIndex??-1;if(v>=0&&!Sf(e,n,v)){let t=e.clipPaths?.[v];if(!t||t.parent>=0&&!Sf(e,n,t.parent))return null;m.push(Array.from(t.edges))}let y=(e,t)=>{let n=r[6]*e+r[7]*t+r[8];return n>1e-6?[(r[0]*e+r[1]*t+r[2])/n,(r[3]*e+r[4]*t+r[5])/n]:null},b=new Float32Array(60),x=bf;for(let e of m){let t=[];for(let n=0;n<e.length;n+=4){let r=y(e[n],e[n+1]),i=(n+4)%e.length;if(!r||Math.hypot(e[n+2]-e[i],e[n+3]-e[i+1])>1e-5*(1+Math.abs(e[i])+Math.abs(e[i+1])))return null;t.push(r)}if(t.length<3)return null;let n=t.reduce((e,n)=>[e[0]+n[0]/t.length,e[1]+n[1]/t.length],[0,0]),r=0;for(let e=0;e<t.length;e++){let[n,i]=t[e],[a,o]=t[(e+1)%t.length],[s,c]=t[(e+2)%t.length],l=(a-n)*(c-o)-(o-i)*(s-a),u=Math.hypot(a-n,o-i)*Math.hypot(s-a,c-o);if(!(Math.abs(l)<=1e-6*u)){if(r&&Math.sign(l)!==r)return null;r=Math.sign(l)}}if(!r)return null;for(let e=0;e<t.length;e++){let[r,i]=t[e],[a,o]=t[(e+1)%t.length],s=Math.hypot(a-r,o-i);if(s<1e-9)continue;if(x>=15)return null;let c=(i-o)/s,l=(a-r)/s,u=-(c*r+l*i);c*n[0]+l*n[1]+u<0&&(c=-c,l=-l,u=-u),b.set([c,l,u,0],x++*4)}}for(;x<15;x++)b.set([0,0,1,0],x*4);let[S,C,w,T,E,D,O,k,A]=r,j=[E*A-D*k,w*k-C*A,C*D-w*E,D*O-T*A,S*A-w*O,w*T-S*D,T*k-E*O,C*O-S*k,S*E-C*T],M=S*j[0]+C*j[3]+w*j[6];if(!(Math.abs(M)>0)||!Number.isFinite(M))return null;for(let e=0;e<9;e++)j[e]/=M;let N=[...[0,1,2].map(e=>u[c]*j[e]+u[c+2]*j[e+3]+d[c]*j[e+6]),...[0,1,2].map(e=>u[c+1]*j[e]+u[c+3]*j[e+3]+d[c+1]*j[e+6]),...j.slice(6)],P=Math.max(...N.map(Math.abs));if(!(P>0)||!Number.isFinite(P))return null;for(let e=0;e<3;e++)b.set([N[e*3]/P,N[e*3+1]/P,N[e*3+2]/P,0],e*4);return b.set(l.subarray(c,c+4),12),b.set([d[c+2],d[c+3],f[c],f[c+1]],16),b.set([f[c+2],f[c+3],e.gradientFillPathMetaC[i*4+3],s],20),b.set(p.subarray(c,c+4),24),b}var wf=1e3,Tf=-1/0;function Ef(e,t){return{blendsPasses:e.blendsPasses,acquire:()=>(t.peak=Math.max(t.peak,++t.live),e.acquire()),release:n=>{t.live--,e.release(n)},clear:(n,r,i)=>{t.clears++,e.clear(n,r,i)},copy:(n,r,i)=>{t.copies++,e.copy(n,r,i)},draw:(n,r,i)=>{t.spans++,t.runs+=n.length,e.draw(n,r,i)},pass:(n,r)=>{t.passes++,e.pass(n,r)},canFold:e.canFold&&(t=>e.canFold(t)),canFoldMaskPaint:e.canFoldMaskPaint&&((t,n)=>e.canFoldMaskPaint(t,n)),drawFolded:e.drawFolded&&((n,r,i,a,o,s)=>{t.folds++,e.drawFolded(n,r,i,a,o,s)})}}function Df(e,t,n,r,i,a){if(!e||!t||!Number.isFinite(e.minX)||!Number.isFinite(e.minY)||!Number.isFinite(e.maxX)||!Number.isFinite(e.maxY))return null;let o=t(e);if(!o)return null;let s=i/Math.max(1,n),c=a/Math.max(1,r),l=Math.floor((o.x-2)*s),u=Math.floor((o.y-2)*c),d=Math.ceil((o.x+o.width+2)*s),f=Math.ceil((o.y+o.height+2)*c),p=Math.max(0,Math.min(i,l)),m=Math.max(0,Math.min(a,u)),h=Math.max(0,Math.min(i,d)-p),g=Math.max(0,Math.min(a,f)-m);return p===0&&m===0&&h>=i&&g>=a?null:{x:p,y:m,width:h,height:g}}function Of(e,t,n,r,i=null,a=!1){let o=globalThis.HEPR_DEBUG_COMPOSITE_STATS===!0?{clears:0,copies:0,passes:0,spans:0,runs:0,folds:0,live:0,peak:0}:null;o&&(t=Ef(t,o));let s=new Set,c=()=>{let e=t.acquire();return s.add(e),e},l=e=>{s.delete(e)&&t.release(e)},u=e=>{let n=c();return t.clear(n,void 0,e),n},d=(e,n)=>{let r=c();return t.copy(e,r,n),r},f=la(e),p=e=>f.nodes.get(e),m=e=>{let t=e*4,n=f.runs;if(!(!n||t+3>=n.length||!Number.isFinite(n[t])))return{minX:n[t],minY:n[t+1],maxX:n[t+2],maxY:n[t+3]}},h=(e,t)=>{if(e&&t)return{minX:Math.min(e.minX,t.minX),minY:Math.min(e.minY,t.minY),maxX:Math.max(e.maxX,t.maxX),maxY:Math.max(e.maxY,t.maxY)}},g=e=>{l(e.color),e.shape&&l(e.shape),e.mask&&l(e.mask)},_=(e,n,r)=>{let i=u(r);if(t.draw(e,i,!1),!n)return{color:i,shape:null};let a=u(r);return t.draw(e,a,!0),{color:i,shape:a}},v=new Map,y=t=>{let n=v.get(t);if(n!==void 0)return n;let a=!1;for(let n of t)if(r(n.optionalContent)){if(n.kind===`group`){if(!y(n.children))continue}else if(n.kind===`draw`&&(i&&!i[n.runIndex]||!r(e.drawRuns[n.runIndex].optionalContent)))continue;a=!0;break}return v.set(t,a),a},b=t=>{if(t.kind===`draw`&&i&&!i[t.runIndex])return null;let n=t.kind===`draw`?e.drawRuns[t.runIndex]:{kind:`raster`,first:t.rasterIndex,count:1};return r(n.optionalContent)?n:null},x=e=>{let t=null;for(let n of e)if(r(n.optionalContent)&&!(n.kind===`group`?!y(n.children):!b(n))){if(t)return null;t=n}return t},S=e=>{if(!t.drawFolded||e.blendMode!==`Normal`)return null;let n=e,r=1,i=!1,a;for(;n.kind===`group`;){if(n.knockout||n!==e&&n.blendMode!==`Normal`&&!i)return null;if(n.softMask){if(a)return null;a=n}r*=n.alpha,i=n.isolated;let t=x(n.children);if(!t)return null;n=t}if(n.kind!==`draw`)return null;let o=b(n);return!o||o.count!==1||o.blendMode&&!i||!t.canFold?.(o)?null:{run:{...o,blendMode:void 0},opacity:r,mask:a}},C=e=>{if(e.transfer?.length||!t.canFoldMaskPaint)return null;let n=x(e.children),r=n?.kind===`draw`?b(n):null;return r&&r.count===1?{...r,blendMode:void 0}:null},w=(e,n,i)=>{let a=[],o=()=>{if(a.length===0)return;let e=a;a=[],t.draw(e,n,!1)},s=(e,r,i)=>{if(r===0&&t.blendsPasses){t.pass({operation:6,source:e.color,opacity:e.opacity,mask:e.mask,isolated:e.opacity!==void 0,blend:!0,bounds:i},n),g(e);return}let a=c();t.copy(n,a,i),t.pass({operation:0,source:e.color,shape:e.shape??void 0,current:a,blendMode:r,opacity:e.opacity,mask:e.mask,isolated:e.opacity!==void 0,bounds:i},n),l(a),g(e)};for(let c of e){if(!r(c.optionalContent))continue;if(c.kind===`group`){if(!y(c.children))continue;o();let e=S(c);if(e){let r=e.mask?.softMask,a=r&&C(r);if(a&&t.canFoldMaskPaint(e.run,a)){t.drawFolded(e.run,n,e.opacity,void 0,r,a);continue}let o=r&&!r.transfer?.length?r:void 0,s=e.mask&&p(e.mask.children),c=r&&(o?E(r,i+2,s):T(r,i+2,s));t.drawFolded(e.run,n,e.opacity,c,o),c&&l(c);continue}s(O(c.children,n,c,i+1,!1),Qi.indexOf(c.blendMode),p(c.children));continue}let e=b(c);if(!e)continue;if(e.blendMode){o();let t=c.kind===`draw`?m(c.runIndex):void 0;for(let n=e.first;n<e.first+e.count;n++)s(_([{...e,first:n,count:1,blendMode:void 0}],!1,t),Qi.indexOf(e.blendMode),t);continue}let u=a[a.length-1];jn(u,e)?u.count+=e.count:a.push({...e,blendMode:void 0})}return o(),n},T=(e,n,r)=>{let i=h(p(e.children),r),a=E(e,n,r),o=c();return t.pass({operation:4,source:a,softMask:e,bounds:i},o),l(a),o},E=(e,t,n)=>w(e.children,u(h(p(e.children),n)),t),D=(e,t,n)=>{let r=p(e),i=t.softMask?T(t.softMask,n+1,r):void 0,a=w(e,u(r),n);return t.alpha===1&&!i?{color:a,shape:null}:{color:a,shape:null,opacity:t.alpha,mask:i}},O=(e,n,i,a,o)=>{if(a>64)throw RangeError(`PDF compositor exceeds its group nesting budget.`);if(i.isolated&&!i.knockout&&!o)return D(e,i,a);let s=o||i.knockout,f=p(e),m=i.softMask?T(i.softMask,a+1,f):void 0,h=i.isolated?u(f):d(n,f),v=d(h,f),x=u(f),S=c(),C=c(),w=(e,n)=>{let r={source:e.color,shape:e.shape??void 0,current:v,stats:x,initial:h,blendMode:n,knockout:i.knockout,bounds:f,opacity:e.opacity,mask:e.mask,isolated:e.opacity!==void 0};t.pass({...r,operation:0},S),t.pass({...r,operation:1},C),[v,S]=[S,v],[x,C]=[C,x],g(e)},E=[],k=e=>{let t=E[E.length-1];jn(t,e)?t.count+=e.count:E.push({...e,blendMode:void 0})},A=()=>{if(E.length===0)return;let e=E;E=[],w(_(e,s,f),0)};for(let t of e)if(r(t.optionalContent)){if(t.kind===`group`){if(!y(t.children))continue;A(),w(O(t.children,i.knockout?h:v,t,a+1,s),Qi.indexOf(t.blendMode))}else{let e=b(t);if(!e)continue;if(i.knockout||e.blendMode){A();for(let t=e.first;t<e.first+e.count;t++)w(_([{...e,first:t,count:1,blendMode:void 0}],s,f),Qi.indexOf(e.blendMode??`Normal`))}else k(e)}}A();let j={color:c(),shape:o?c():null},M={current:v,stats:x,initial:h,mask:m,bounds:f,opacity:i.alpha,alphaIsShape:i.alphaIsShape};t.pass({...M,operation:2},j.color),j.shape&&t.pass({...M,operation:3},j.shape),m&&l(m);for(let e of[h,v,x,S,C])l(e);return j};try{let t=w(ia(e),a?n:d(n),0);return s.delete(t),t}finally{for(let e of s)t.release(e);o&&performance.now()-Tf>=wf&&(Tf=performance.now(),console.info(`[hepr] PDF composite frame: ${o.clears+o.copies+o.passes} surface ops (${o.passes} passes, ${o.clears} clears, ${o.copies} copies), ${o.spans} span draws over ${o.runs} paints, ${o.folds} folded paints, ${o.peak} peak surfaces.`))}}function kf(e){let t=e===`wgsl`,n=e=>({F:`f32`,I:`i32`,V3:`vec3f`,V4:`vec4f`})[e]??e,r=e=>t?e.replace(/\b(F|I|V3|V4)\b/g,n):e.replace(/\bF\b/g,`float`).replace(/\bI\b/g,`int`).replace(/\bV3\b/g,`vec3`).replace(/\bV4\b/g,`vec4`),i=(e,n,i,a)=>{let o=n.split(`,`).map(e=>e.trim().split(` `));return r(t?`fn ${e}(${o.map(([e,t])=>`${t}: ${e}`).join(`, `)}) -> ${i} {${a}}`:`${i} ${e}(${n}) {${a}}`)},a=(e,n,r)=>t?`var ${n}: ${e} = ${r};`:`${e} ${n} = ${r};`;return[i(`pdfLum`,`V3 c`,`F`,`return dot(c, V3(0.3, 0.59, 0.11));`),i(`pdfSat`,`V3 c`,`F`,`return max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b);`),i(`pdfSetSat`,`V3 c, F s`,`V3`,`${a(`F`,`n`,`min(min(c.r,c.g),c.b)`)}${a(`F`,`d`,`pdfSat(c)`)}
      if (d <= 0.0) { return V3(0.0); } return (c - V3(n)) * s / d;`),i(`pdfSetLum`,`V3 c, F l`,`V3`,`${a(`V3`,`r`,`c + V3(l - pdfLum(c))`)}
      ${a(`F`,`n`,`min(min(r.r,r.g),r.b)`)}${a(`F`,`x`,`max(max(r.r,r.g),r.b)`)}
      if (n < 0.0) { r = V3(l) + (r-V3(l))*l/(l-n); }
      if (x > 1.0) { r = V3(l) + (r-V3(l))*(1.0-l)/(x-l); } return r;`),i(`pdfBlendChannel`,`F b, F s, I mode`,`F`,`
      if (mode == 1) { return b*s; }
      if (mode == 2) { return b+s-b*s; }
      if (mode == 3) { if (b <= 0.5) { return 2.0*b*s; } return 1.0-2.0*(1.0-b)*(1.0-s); }
      if (mode == 4) { return min(b,s); }
      if (mode == 5) { return max(b,s); }
      if (mode == 6) { if (b <= 0.0) { return 0.0; } if (s >= 1.0) { return 1.0; } return min(1.0,b/(1.0-s)); }
      if (mode == 7) { if (b >= 1.0) { return 1.0; } if (s <= 0.0) { return 0.0; } return 1.0-min(1.0,(1.0-b)/s); }
      if (mode == 8) { if (s <= 0.5) { return 2.0*b*s; } return 1.0-2.0*(1.0-b)*(1.0-s); }
      if (mode == 9) { if (s <= 0.5) { return b-(1.0-2.0*s)*b*(1.0-b); }
        ${a(`F`,`d`,`sqrt(b)`)} if (b <= 0.25) { d=((16.0*b-12.0)*b+4.0)*b; } return b+(2.0*s-1.0)*(d-b); }
      if (mode == 10) { return abs(b-s); }
      if (mode == 11) { return b+s-2.0*b*s; } return s;`),i(`pdfBlend`,`V3 b, V3 s, I mode`,`V3`,`
      if (mode == 12) { return pdfSetLum(pdfSetSat(s,pdfSat(b)),pdfLum(b)); }
      if (mode == 13) { return pdfSetLum(pdfSetSat(b,pdfSat(s)),pdfLum(b)); }
      if (mode == 14) { return pdfSetLum(s,pdfLum(b)); }
      if (mode == 15) { return pdfSetLum(b,pdfLum(s)); }
      return V3(pdfBlendChannel(b.r,s.r,mode),pdfBlendChannel(b.g,s.g,mode),pdfBlendChannel(b.b,s.b,mode));`),i(`pdfOver`,`V4 b, V4 s, I mode`,`V4`,`
      ${a(`V3`,`cb`,`b.rgb / max(b.a, 0.0000001)`)}${a(`V3`,`cs`,`s.rgb / max(s.a, 0.0000001)`)}
      return V4((1.0-s.a)*b.rgb+(1.0-b.a)*s.rgb+b.a*s.a*pdfBlend(cb,cs,mode),s.a+b.a*(1.0-s.a));`),i(`pdfCompositePass`,`V4 source, V4 shape, V4 current, V4 stats, V4 initial, V4 mask, V4 p, V4 q`,`V4`,`
      ${a(`I`,`operation`,`I(p.x)`)}
      // A group accumulated into a single isolated surface is already its own
      // extracted layer, so its opacity and soft mask are a uniform scale of
      // premultiplied color. Applying it here, where the layer is read anyway,
      // spares that group an extraction pass and a surface of its own.
      ${a(`V4`,`src`,`source`)} if (q.w > 0.5) { src=source*(p.w*mask.r); }
      // Operation 6 emits the layer itself, for a destination whose blender
      // performs the source-over that operation 0 would compute here.
      // One exit: D3D's FXC (under ANGLE) cannot prove that early returns
      // here cover every path and warns X4000 about the result.
      ${a(`V4`,`result`,`src`)}
      if (operation == 0) {
        ${a(`V4`,`backdrop`,`current`)} if (p.z > 0.5) { backdrop=initial; }
        result=pdfOver(backdrop,src,I(p.y));
        if (p.z > 0.5) { result=result+(1.0-shape.a)*(current-initial); }
        result=clamp(result,V4(0.0),V4(1.0));
      } else if (operation == 1) {
        ${a(`F`,`previousWeight`,`1.0-src.a`)} if (p.z > 0.5) { previousWeight=1.0-shape.a; }
        result=V4(src.a+previousWeight*stats.r,shape.a+(1.0-shape.a)*stats.g,0.0,1.0);
      } else if (operation == 2) {
        ${a(`F`,`opacity`,`p.w*mask.r`)}
        result=V4(clamp(current.rgb-initial.rgb*(1.0-stats.r),V3(0.0),V3(1.0))*opacity,stats.r*opacity);
      } else if (operation == 3) {
        ${a(`F`,`coverage`,`stats.g`)} if (q.x > 0.5) { coverage=coverage*p.w*mask.r; }
        result=V4(coverage);
      }
      return result;
    `)].join(`
`)}var Af=`#version 300 es
precision highp float;
void main() {
  vec2 p=vec2(float((gl_VertexID << 1) & 2),float(gl_VertexID & 2));
  gl_Position=vec4(p*2.0-1.0,0.0,1.0);
}`,jf=`#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uSource;
uniform sampler2D uShape;
uniform sampler2D uCurrent;
uniform sampler2D uStats;
uniform sampler2D uInitial;
uniform sampler2D uMask;
uniform sampler2D uTransfer;
uniform vec4 uParams;
uniform vec4 uExtra;
uniform vec3 uMaskBackdrop;
out vec4 outColor;
${kf(`glsl`)}


vec4 pdfCompositeLoad(sampler2D inputTexture, ivec2 point) {
  return texelFetch(inputTexture,clamp(point,ivec2(0),textureSize(inputTexture,0)-ivec2(1)),0);
}
float pdfTransferSample(int index) {
  int width=textureSize(uTransfer,0).x;
  return texelFetch(uTransfer,ivec2(index%width,index/width),0).r;
}
void main() {
  ivec2 p=ivec2(gl_FragCoord.xy);
  vec4 source=pdfCompositeLoad(uSource,p);
  if (uParams.x==4.0) {
    float value=source.a;
    if (uExtra.y>0.5) value=pdfLum(source.rgb+(1.0-source.a)*uMaskBackdrop);
    value=clamp(value,0.0,1.0);
    if (uExtra.z>1.0) {
      float at=value*(uExtra.z-1.0); int first=int(floor(at));
      value=mix(pdfTransferSample(first),pdfTransferSample(min(first+1,int(uExtra.z)-1)),fract(at));
    }
    outColor=vec4(value); return;
  }
  outColor=pdfCompositePass(source,pdfCompositeLoad(uShape,p),pdfCompositeLoad(uCurrent,p),pdfCompositeLoad(uStats,p),
    pdfCompositeLoad(uInitial,p),pdfCompositeLoad(uMask,p),uParams,uExtra);
}`,Mf=`
struct Params { p:vec4f, q:vec4f, backdrop:vec4f }
@group(0) @binding(0) var<uniform> params:Params;
@group(0) @binding(1) var sourceTex:texture_2d<f32>;
@group(0) @binding(2) var shapeTex:texture_2d<f32>;
@group(0) @binding(3) var currentTex:texture_2d<f32>;
@group(0) @binding(4) var statsTex:texture_2d<f32>;
@group(0) @binding(5) var initialTex:texture_2d<f32>;
@group(0) @binding(6) var maskTex:texture_2d<f32>;
@group(0) @binding(7) var transferTex:texture_2d<f32>;
${kf(`wgsl`)}

fn pdfCompositeLoad(inputTexture:texture_2d<f32>, point:vec2i)->vec4f {
  return textureLoad(inputTexture,clamp(point,vec2i(0),vec2i(textureDimensions(inputTexture))-vec2i(1)),0);
}
fn pdfTransferSample(index:i32)->f32 {
  let width=i32(textureDimensions(transferTex).x);
  return textureLoad(transferTex,vec2i(index%width,index/width),0).r;
}
@vertex fn vs(@builtin(vertex_index) index:u32)->@builtin(position) vec4f {
  let p=vec2f(f32((index << 1u) & 2u),f32(index & 2u));
  return vec4f(p*2.0-vec2f(1.0),0.0,1.0);
}
@fragment fn fs(@builtin(position) position:vec4f)->@location(0) vec4f {
  if (params.p.x==5.0) {
    let dimensions=vec2i(textureDimensions(sourceTex));
    let point=position.xy/max(params.backdrop.xy,vec2f(1.0))*vec2f(dimensions)-vec2f(0.5);
    let low=vec2i(floor(point)); let fraction=fract(point);
    let a=textureLoad(sourceTex,clamp(low,vec2i(0),dimensions-vec2i(1)),0);
    let b=textureLoad(sourceTex,clamp(low+vec2i(1,0),vec2i(0),dimensions-vec2i(1)),0);
    let c=textureLoad(sourceTex,clamp(low+vec2i(0,1),vec2i(0),dimensions-vec2i(1)),0);
    let d=textureLoad(sourceTex,clamp(low+vec2i(1,1),vec2i(0),dimensions-vec2i(1)),0);
    return mix(mix(a,b,fraction.x),mix(c,d,fraction.x),fraction.y);
  }
  let p=vec2i(position.xy); let source=pdfCompositeLoad(sourceTex,p);
  if (params.p.x==4.0) {
    var value=source.a;
    if (params.q.y>0.5) { value=pdfLum(source.rgb+(1.0-source.a)*params.backdrop.rgb); }
    value=clamp(value,0.0,1.0);
    if (params.q.z>1.0) {
      let at=value*(params.q.z-1.0); let first=i32(floor(at));
      value=mix(pdfTransferSample(first),pdfTransferSample(min(first+1,i32(params.q.z)-1)),fract(at));
    }
    return vec4f(value);
  }
  return pdfCompositePass(source,pdfCompositeLoad(shapeTex,p),pdfCompositeLoad(currentTex,p),pdfCompositeLoad(statsTex,p),
    pdfCompositeLoad(initialTex,p),pdfCompositeLoad(maskTex,p),params.p,params.q);
}`,Nf=536870912,Pf=new WeakMap;function Ff(){let e=globalThis,t=e.HEPR_DEBUG_COMPOSITE_SCALE;if(t===void 0&&typeof e.location?.search==`string`){let n=new URLSearchParams(e.location.search).get(`compositeScale`);n!==null&&(t=Number(n))}return typeof t==`number`&&Number.isFinite(t)&&t>0&&t<=1?t:1}function If(e,t,n,r=Nf,i=4){if(!Number.isSafeInteger(t)||!Number.isSafeInteger(n)||t<=0||n<=0||!Number.isFinite(r)||r<=0||!Number.isFinite(i)||i<=0)throw RangeError(`Invalid PDF composite viewport or byte budget.`);let a=Pf.get(e);if(a===void 0){let t=(e,n)=>{if(n>64)throw RangeError(`PDF compositor exceeds its group nesting budget.`);let r=n;for(let i of e)i.kind===`group`&&(r=Math.max(r,t(i.children,n+1)),i.softMask&&(r=Math.max(r,t(i.softMask.children,n+2))));return r};a=8*(t(ia(e),0)+1)+8,Pf.set(e,a)}let o=Math.min(1,Math.sqrt(r/(t*n*i*a)))*Ff();return{width:Math.max(1,Math.floor(t*o)),height:Math.max(1,Math.floor(n*o)),scale:o,estimatedSurfaces:a}}var Lf=7;function Rf(e){if(!e)return[1,0,0,0,0];if(e.subtype!==`Luminosity`)return[0,0,0,1,0];let[t,n,r]=e.backdrop??[0,0,0],i=.3*t+.59*n+.11*r;return[.3,.59,.11,-i,i]}var zf=(rr+ar).replace(/heprGradient/g,`heprFoldGradient`),Bf=(ir+or).replace(/heprGradient/g,`heprFoldGradient`);function Vf(e,t=!1){let n=/void\s+main\s*\(\s*\)/;if(!n.test(e))throw Error(`Folded paint shader has no main function.`);let r=Array.from({length:8},(e,t)=>`  coverage *= clamp(0.5 + dot(uPaintMaskGradient[${Lf+t}].xyz, p), 0.0, 1.0);`).join(`
`);return e.replace(n,`void heprUnfoldedPaint()`)+`
uniform vec4 uPaintFold;
uniform vec4 uPaintMaskWeights;
uniform vec4 uPaintMaskGradient[15];
uniform highp sampler2D uPaintMask;
${zf}
vec4 heprFoldGradientMask(vec2 pixel) {
  vec3 p = vec3(pixel, 1.0);
  vec3 h = vec3(dot(uPaintMaskGradient[0].xyz, p), dot(uPaintMaskGradient[1].xyz, p), dot(uPaintMaskGradient[2].xyz, p));
  vec2 q = h.xy / h.z;
  vec4 a = uPaintMaskGradient[3], ends = uPaintMaskGradient[4], extra = uPaintMaskGradient[5], box = uPaintMaskGradient[6];
  vec4 color = vec4(0.0);
  if (a.y < 0.5 || (q.x >= box.x && q.y >= box.y && q.x <= box.z && q.y <= box.w)) {
    vec2 parameter = heprFoldGradientParameter(a, vec4(0.0, 0.0, ends.xy), vec4(ends.zw, extra.xy), q);
    if (parameter.y < 0.5) {
      color = heprFoldGradientBackground(a.w);
    } else {
      float x = clamp(parameter.x, 0.0, 1.0) * 1023.0;
      int x0 = int(floor(x));
      int row = int(extra.w + 0.5);
      color = mix(texelFetch(uPaintMask, ivec2(x0, row), 0), texelFetch(uPaintMask, ivec2(min(x0 + 1, 1023), row), 0),
        x - float(x0));
    }
  }
  float coverage = extra.z;
${r}
  vec3 rgb = clamp(color.rgb, 0.0, 1.0);
  if (uPaintFold.y > 2.5) rgb = mix(pow((rgb + 0.055) / 1.055, vec3(2.4)), rgb / 12.92, lessThanEqual(rgb, vec3(0.04045)));
  float alpha = coverage * color.a;
  return vec4(rgb * alpha, alpha);
}
void main() {
  heprUnfoldedPaint();
  if (uPaintFold.y < 0.5) {
    ${t?`outColor`:`outColor.a`} *= uPaintFold.x;
    return;
  }
  vec4 mask = uPaintFold.y < 1.5 ? texelFetch(uPaintMask, ivec2(gl_FragCoord.xy), 0) : heprFoldGradientMask(gl_FragCoord.xy);
  ${t?`outColor`:`outColor.a`} *= uPaintFold.x * clamp(dot(mask, uPaintMaskWeights) + uPaintFold.z, 0.0, 1.0);
}
`}var Hf=`
fn heprPaintFoldScale(pixel: vec2f, mask: texture_2d<f32>, fold: vec4f, weights: vec4f, ${Array.from({length:15},(e,t)=>`d${t}: vec4f`).join(`, `)}) -> f32 {
  if (fold.y < 0.5) { return fold.x; }
  var value: vec4f;
  if (fold.y < 1.5) {
    
    let size = vec2<i32>(textureDimensions(mask));
    value = textureLoad(mask, clamp(vec2<i32>(pixel), vec2<i32>(0), size - vec2<i32>(1)), 0);
  } else {
    let p = vec3f(pixel, 1.0);
    let h = vec3f(dot(d0.xyz, p), dot(d1.xyz, p), dot(d2.xyz, p));
    let q = h.xy / h.z;
    var color = vec4f(0.0);
    if (d3.y < 0.5 || (q.x >= d6.x && q.y >= d6.y && q.x <= d6.z && q.y <= d6.w)) {
      let parameter = heprFoldGradientParameter(d3, vec4f(0.0, 0.0, d4.xy), vec4f(d4.zw, d5.xy), q);
      if (parameter.y < 0.5) {
        color = heprFoldGradientBackground(d3.w);
      } else {
        let x = clamp(parameter.x, 0.0, 1.0) * 1023.0;
        let x0 = i32(floor(x));
        let row = i32(d5.w + 0.5);
        color = mix(textureLoad(mask, vec2<i32>(x0, row), 0), textureLoad(mask, vec2<i32>(min(x0 + 1, 1023), row), 0),
          x - f32(x0));
      }
    }
    var coverage = d5.z;
${Array.from({length:8},(e,t)=>`    coverage *= clamp(0.5 + dot(d${Lf+t}.xyz, p), 0.0, 1.0);`).join(`
`)}
    var rgb = clamp(color.rgb, vec3f(0.0), vec3f(1.0));
    if (fold.y > 2.5) { rgb = select(pow((rgb + 0.055) / 1.055, vec3f(2.4)), rgb / 12.92, rgb <= vec3f(0.04045)); }
    let alpha = coverage * color.a;
    value = vec4f(rgb * alpha, alpha);
  }
  return fold.x * clamp(dot(value, weights) + fold.z, 0.0, 1.0);
}
`;function Uf(e,t){let n=/@fragment\s+fn fsMain\(inData\s*:\s*(\w+)\)\s*->\s*@location\(0\)\s*vec4f/,r=e.match(n);if(!r)throw Error(`Folded paint shader has no supported fragment entry point.`);return e.replace(n,`fn heprUnfoldedPaint(inData: ${r[1]}) -> vec4f`)+`
struct HeprPaintFold { fold: vec4f, maskWeights: vec4f, gradient: array<vec4f, 15> };
${Bf}
${Hf}
@group(${t}) @binding(0) var<uniform> uPaintFold : HeprPaintFold;
@group(${t}) @binding(1) var uPaintMask : texture_2d<f32>;

@fragment
fn fsMain(inData: ${r[1]}) -> @location(0) vec4f {
  let color = heprUnfoldedPaint(inData);
  let fold = heprPaintFoldScale(inData.position.xy, uPaintMask, uPaintFold.fold, uPaintFold.maskWeights,
    ${Array.from({length:15},(e,t)=>`uPaintFold.gradient[${t}]`).join(`, `)});
  return vec4f(color.rgb, color.a * fold);
}
`}function Wf(e){return!e.includes(`gl_Position`)&&!e.includes(`outColor`)||e.includes(`uPdfShapeOnly`)?e:(e=e.replace(/precision highp float;/,`precision highp float;
uniform float uPdfShapeOnly;
`),e.includes(`gl_Position`)?e.replace(/alpha <= 0\.001/g,`(alpha <= 0.001 && uPdfShapeOnly < 0.5)`).replace(/instanceC\.w <= 0\.001/g,`(instanceC.w <= 0.001 && uPdfShapeOnly < 0.5)`):e.replace(/\bvAlpha\b(?!\s*;)/g,`mix(vAlpha, 1.0, uPdfShapeOnly)`).replace(/\bvColorAlpha\b(?!\s*;)/g,`mix(vColorAlpha, 1.0, uPdfShapeOnly)`).replace(/\* uRasterOpacity/g,`* mix(uRasterOpacity, 1.0, uPdfShapeOnly)`).replace(/\* maskAlpha/g,`* mix(maskAlpha, 1.0, uPdfShapeOnly)`))}function Gf(e){return e.replace(/\|\|\s*alpha <= 0\.001/g,``).replace(/alpha <= 0\.001\s*\|\|/g,``).replace(/\|\|\s*instanceC\.w <= 0\.001/g,``).replace(/\binData\.alpha\b/g,`1.0`).replace(/\binData\.colorAlpha\b/g,`1.0`).replace(/\* maskAlpha/g,``).replace(/\* uRaster\.(?:opacity|matrixB\.z)/g,``)}function Kf(e,t,n){let r=1e-6;for(let i of[n.minX,n.maxX])for(let a of[n.minY,n.maxY]){let n=e[3]*i+e[7]*a+e[15];if(n<=1e-10)continue;let o=e[0]*i+e[4]*a+e[12],s=e[1]*i+e[5]*a+e[13],c=(e[0]*n-o*e[3])/(n*n)*t.width*.5,l=(e[4]*n-o*e[7])/(n*n)*t.width*.5,u=(e[1]*n-s*e[3])/(n*n)*t.height*.5,d=(e[5]*n-s*e[7])/(n*n)*t.height*.5,f=c*c+l*l+u*u+d*d,p=c*d-l*u,m=(f+Math.sqrt(Math.max(0,f*f-4*p*p)))*.5,h=Math.sqrt(m)/Math.max(1e-12,Math.abs(p));Number.isFinite(h)&&(r=Math.max(r,h))}return r}function qf(e){return e.replace(/depth < \d+/,`depth < 66`)}var Jf=`#version 300 es
precision highp float;
layout(location=0) in vec4 aSegmentA;
layout(location=1) in vec4 aSegmentB;
layout(location=2) in float aHighlightIndex;
uniform mat4 uLocalToClip;
uniform float uLocalUnitsPerPixel;
uniform float uPixelRatio;
uniform float uSelectionCount;
out vec2 vLocal;
flat out vec4 vSegmentA;
flat out vec4 vSegmentB;
flat out vec3 vColor;
void main() {
  vec2 p0 = aSegmentA.xy;
  vec2 p1 = aSegmentB.xy;
  vec2 control = aSegmentB.z >= 0.5 ? aSegmentA.zw : (p0 + p1) * 0.5;
  float extent = max(uLocalUnitsPerPixel, 0.000001) * (uPixelRatio + 2.0);
  vec2 axis = p1 - p0;
  float axisLength = length(axis);
  vec2 u = axisLength > 0.000001 ? axis / axisLength : vec2(1.0, 0.0);
  vec2 v = vec2(-u.y, u.x);
  vec2 c = control - p0;
  vec2 low = vec2(min(0.0, dot(c, u)), min(0.0, dot(c, v))) - extent;
  vec2 high = vec2(max(axisLength, dot(c, u)), max(0.0, dot(c, v))) + extent;
  vec2 corner = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  vec2 local = mix(low, high, corner);
  vLocal = p0 + u * local.x + v * local.y;
  vSegmentA = aSegmentA;
  vSegmentB = aSegmentB;
  vColor = aHighlightIndex < uSelectionCount ? vec3(${fi.join(`,`)}) : vec3(${pi.join(`,`)});
  gl_Position = uLocalToClip * vec4(vLocal, 0.0, 1.0);
}
`,Yf=`#version 300 es
precision highp float;
precision highp sampler2D;
uniform float uPixelRatio;
in vec2 vLocal;
flat in vec4 vSegmentA;
flat in vec4 vSegmentB;
flat in vec3 vColor;
out vec4 outColor;
${qf(jd).replace(`int(uVectorClipIndex)`,`int(vSegmentB.w)`)}
vec2 heprOffsetToLineSegment(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float abLenSq = dot(ab, ab);
  if (abLenSq <= 1e-10) {
    return a - p;
  }
  float t = clamp(dot(p - a, ab) / abLenSq, 0.0, 1.0);
  return a + ab * t - p;
}

vec2 heprOffsetToQuadraticBezier(vec2 p, vec2 a, vec2 b, vec2 c) {
  vec2 aa = b - a;
  vec2 bb = a - 2.0 * b + c;
  vec2 cc = aa * 2.0;
  vec2 dd = a - p;

  float bbLenSq = dot(bb, bb);
  if (bbLenSq <= 1e-12) {
    return heprOffsetToLineSegment(p, a, c);
  }

  float inv = 1.0 / bbLenSq;
  float kx = inv * dot(aa, bb);
  float ky = inv * (2.0 * dot(aa, aa) + dot(dd, bb)) / 3.0;
  float kz = inv * dot(dd, aa);

  float pValue = ky - kx * kx;
  float pCube = pValue * pValue * pValue;
  float qValue = kx * (2.0 * kx * kx - 3.0 * ky) + kz;
  float hValue = qValue * qValue + 4.0 * pCube;

  float best = 1e20;
  vec2 bestOffset = vec2(0.0);

  if (hValue >= 0.0) {
    float hSqrt = sqrt(hValue);
    vec2 roots = (vec2(hSqrt, -hSqrt) - qValue) * 0.5;
    vec2 uv = sign(roots) * pow(abs(roots), vec2(1.0 / 3.0));
    float t = clamp(uv.x + uv.y - kx, 0.0, 1.0);
    vec2 delta = dd + (cc + bb * t) * t;
    best = dot(delta, delta);
    bestOffset = delta;
  } else {
    float z = sqrt(-pValue);
    float acosArg = clamp(qValue / (2.0 * pValue * z), -1.0, 1.0);
    float angle = acos(acosArg) / 3.0;
    float cosine = cos(angle);
    float sine = sin(angle) * 1.732050808;
    vec3 t = clamp(vec3(cosine + cosine, -sine - cosine, sine - cosine) * z - kx, 0.0, 1.0);

    vec2 delta = dd + (cc + bb * t.x) * t.x;
    if (dot(delta, delta) < best) { best = dot(delta, delta); bestOffset = delta; }
    delta = dd + (cc + bb * t.y) * t.y;
    if (dot(delta, delta) < best) { best = dot(delta, delta); bestOffset = delta; }
    delta = dd + (cc + bb * t.z) * t.z;
    if (dot(delta, delta) < best) { best = dot(delta, delta); bestOffset = delta; }
  }

  return bestOffset;
}


void main() {
  vec2 offset = vSegmentB.z >= 0.5
    ? heprOffsetToQuadraticBezier(vLocal,vSegmentA.xy,vSegmentA.zw,vSegmentB.xy)
    : heprOffsetToLineSegment(vLocal,vSegmentA.xy,vSegmentB.xy);
  float distanceValue = length(offset);
  vec2 axis = vSegmentB.xy - vSegmentA.xy;
  vec2 normal = distanceValue > 0.00000001 ? offset / distanceValue
    : (length(axis) > 0.00000001 ? normalize(vec2(-axis.y, axis.x)) : vec2(1.0, 0.0));
  float localPerPixel = max(length(vec2(dot(normal, dFdx(vLocal)), dot(normal, dFdy(vLocal)))), 0.000001);
  float alpha = 1.0 - smoothstep(max(0.0,uPixelRatio-0.75)*localPerPixel,(uPixelRatio+0.75)*localPerPixel,distanceValue);
  alpha *= heprVectorClip(vLocal);
  if (alpha <= 0.001) discard;
  outColor = vec4(vColor, alpha);
}
`,Xf=`
fn heprOffsetToLineSegment(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
  let ab = b - a;
  let abLenSq = dot(ab, ab);
  if (abLenSq <= 1e-10) {
    return a - p;
  }
  let t = clamp(dot(p - a, ab) / abLenSq, 0.0, 1.0);
  return a + ab * t - p;
}
`,Zf=`
fn heprOffsetToQuadraticBezier(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>, c: vec2<f32>) -> vec2<f32> {
  let aa = b - a;
  let bb = a - 2.0 * b + c;
  let cc = aa * 2.0;
  let dd = a - p;

  let bbLenSq = dot(bb, bb);
  if (bbLenSq <= 1e-12) {
    return heprOffsetToLineSegment(p, a, c);
  }

  let inv = 1.0 / bbLenSq;
  let kx = inv * dot(aa, bb);
  let ky = inv * (2.0 * dot(aa, aa) + dot(dd, bb)) / 3.0;
  let kz = inv * dot(dd, aa);

  let pValue = ky - kx * kx;
  let pCube = pValue * pValue * pValue;
  let qValue = kx * (2.0 * kx * kx - 3.0 * ky) + kz;
  let hValue = qValue * qValue + 4.0 * pCube;

  var best = 1e20;
  var bestOffset = vec2<f32>(0.0);

  if (hValue >= 0.0) {
    let hSqrt = sqrt(hValue);
    let roots = (vec2<f32>(hSqrt, -hSqrt) - vec2<f32>(qValue)) * 0.5;
    let uv = sign(roots) * pow(abs(roots), vec2<f32>(1.0 / 3.0));
    let t = clamp(uv.x + uv.y - kx, 0.0, 1.0);
    let delta = dd + (cc + bb * t) * t;
    best = dot(delta, delta);
    bestOffset = delta;
  } else {
    let z = sqrt(-pValue);
    let acosArg = clamp(qValue / (2.0 * pValue * z), -1.0, 1.0);
    let angle = acos(acosArg) / 3.0;
    let cosine = cos(angle);
    let sine = sin(angle) * 1.732050808;
    let t = clamp(
      vec3<f32>(cosine + cosine, -sine - cosine, sine - cosine) * z - vec3<f32>(kx),
      vec3<f32>(0.0),
      vec3<f32>(1.0)
    );

    var delta = dd + (cc + bb * t.x) * t.x;
    if (dot(delta, delta) < best) { best = dot(delta, delta); bestOffset = delta; }
    delta = dd + (cc + bb * t.y) * t.y;
    if (dot(delta, delta) < best) { best = dot(delta, delta); bestOffset = delta; }
    delta = dd + (cc + bb * t.z) * t.z;
    if (dot(delta, delta) < best) { best = dot(delta, delta); bestOffset = delta; }
  }

  return bestOffset;
}
`,Qf=`
fn heprPrimitiveHighlightCoverage(point: vec2<f32>, a: vec4<f32>, b: vec4<f32>, pixelRatio: f32) -> f32 {
  let offset = select(heprOffsetToLineSegment(point,a.xy,b.xy),heprOffsetToQuadraticBezier(point,a.xy,a.zw,b.xy),b.z >= 0.5);
  let distanceValue = length(offset);
  let axis = b.xy-a.xy;
  let fallback = select(vec2<f32>(1.0,0.0),vec2<f32>(-axis.y,axis.x)/max(length(axis),0.00000001),length(axis)>0.00000001);
  let normal = select(fallback,offset/max(distanceValue,0.00000001),distanceValue>0.00000001);
  let localPerPixel = max(length(vec2<f32>(dot(normal,dpdx(point)),dot(normal,dpdy(point)))),0.000001);
  return 1.0-smoothstep(max(0.0,pixelRatio-0.75)*localPerPixel,(pixelRatio+0.75)*localPerPixel,distanceValue);
}
`,$f=`
fn heprPrimitiveHighlightPosition(corner: vec2<f32>, a: vec4<f32>, b: vec4<f32>, localUnitsPerPixel: f32, pixelRatio: f32) -> vec2<f32> {
  let p0=a.xy;
  let p1=b.xy;
  let control=select((p0+p1)*0.5,a.zw,b.z>=0.5);
  let extent=max(localUnitsPerPixel,0.000001)*(pixelRatio+2.0);
  let axis=p1-p0;
  let axisLength=length(axis);
  let u=select(vec2<f32>(1.0,0.0),axis/max(axisLength,0.000001),axisLength>0.000001);
  let v=vec2<f32>(-u.y,u.x);
  let c=control-p0;
  let low=vec2<f32>(min(0.0,dot(c,u)),min(0.0,dot(c,v)))-vec2<f32>(extent);
  let high=vec2<f32>(max(axisLength,dot(c,u)),max(0.0,dot(c,v)))+vec2<f32>(extent);
  let xy=mix(low,high,corner);
  return p0+u*xy.x+v*xy.y;
}
`,ep=`
struct Camera { matrix: mat4x4f, params: vec4f }
struct Segment { a: vec4f, b: vec4f }
@group(0) @binding(0) var<uniform> uCamera: Camera;
@group(0) @binding(1) var<storage,read> uSegments: array<Segment>;
@group(0) @binding(2) var uClips: texture_2d<f32>;
struct Output {
  @builtin(position) position: vec4f,
  @location(0) local: vec2f,
  @location(1) @interpolate(flat) a: vec4f,
  @location(2) @interpolate(flat) b: vec4f,
  @location(3) @interpolate(flat) color: vec3f
}
${Xf}
${Zf}
${Qf}
${qf(Md)}
@vertex fn vsMain(@builtin(vertex_index) vertex: u32,@builtin(instance_index) instance: u32) -> Output {
  let segment = uSegments[instance];
  let p0 = segment.a.xy;
  let p1 = segment.b.xy;
  let control = select((p0+p1)*0.5,segment.a.zw,segment.b.z>=0.5);
  let extent = max(uCamera.params.x,0.000001)*(uCamera.params.y+2.0);
  let axis = p1-p0;
  let axisLength = length(axis);
  let u = select(vec2f(1.0,0.0),axis/max(axisLength,0.000001),axisLength>0.000001);
  let v = vec2f(-u.y,u.x);
  let c = control-p0;
  let low = vec2f(min(0.0,dot(c,u)),min(0.0,dot(c,v)))-vec2f(extent);
  let high = vec2f(max(axisLength,dot(c,u)),max(0.0,dot(c,v)))+vec2f(extent);
  let corner = vec2f(f32(vertex & 1u),f32((vertex >> 1u) & 1u));
  let xy = mix(low,high,corner);
  var out: Output;
  out.local = p0+u*xy.x+v*xy.y;
  out.position = uCamera.matrix*vec4f(out.local,0.0,1.0);
  out.a=segment.a;
  out.b=segment.b;
  out.color=select(vec3f(${pi.join(`,`)}),vec3f(${fi.join(`,`)}),f32(instance)<uCamera.params.z);
  return out;
}
@fragment fn fsMain(inData: Output) -> @location(0) vec4f {
  let alpha=heprPrimitiveHighlightCoverage(inData.local,inData.a,inData.b,uCamera.params.y)*heprVectorClip(inData.local,inData.b.w,uClips);
  if(alpha<=0.001){discard;}
  return vec4f(inData.color,alpha);
}
`;function tp(e,t=!1){return e.replace(/void\s+main\s*\(\s*\)/,`void heprMultiplyPaint()`)+`
${t?`uniform bool uHeprMultiply;`:``}
void main() {
  heprMultiplyPaint();
  ${t?`if (uHeprMultiply) `:``}outColor.rgb *= outColor.a;
}
`}function np(e){let t=/@fragment\s+fn fsMain\(inData\s*:\s*(\w+)\)\s*->\s*@location\(0\)\s*vec4f/,n=e.match(t);if(!n)throw Error(`Multiply paint shader has no supported fragment entry point.`);return e.replace(t,`fn heprMultiplyPaint(inData: ${n[1]}) -> vec4f`)+`
@fragment
fn fsMain(inData: ${n[1]}) -> @location(0) vec4f {
  let color = heprMultiplyPaint(inData);
  return vec4f(color.rgb * color.a, color.a);
}
`}function rp(e){return{color:{srcFactor:e===0?`dst`:`one-minus-dst-alpha`,dstFactor:e===0?`one-minus-src-alpha`:`one`,operation:`add`},alpha:{srcFactor:e===0?`zero`:`one`,dstFactor:e===0?`one`:`one-minus-src-alpha`,operation:`add`}}}var ip=[`stroke`,`fill`,`text`,`raster`,`gradient-fill`,`gradient-stroke`],ap=128,op=128,sp=1024,cp=.875,lp=256,up=1024,dp=class e{independentGroups=1;paintOrderApproximated=!1;bounds;pageForRun;kindForRun;colorForRun;components;pageBounds;paintBounds;heads;tails;next;ordered=[];compacted=[];colorGrouped=[];skipped=new Int32Array(ap);previousPaints;selectedPaints;allPaints;filtered=[];segmentRuns=[];segments;independentPages;paddingLimit;previousPaintCount=-1;scheduleDirty=!0;padding=NaN;enabled=!1;colorCommutationEnabled=!0;textLodData=null;static create(t,n,r,i=null,a=null){let o=(t.pageRects?.length??0)/4;return!t.drawRuns||o<1||o>512||!Number.isInteger(o)||!t.pageRects.every(Number.isFinite)||i&&i.length!==t.drawRuns.length||a&&(a.length!==t.drawRuns.length||a.some(e=>e>=o))?null:new e(t,n,r,i,a)}constructor(e,t,n,r,i){let a=e.drawRuns,o=e.pageRects.length/4;this.segments=r,this.independentPages=i!==null,this.bounds=new Ji(e,{records:t,sourceRuns:n}),this.pageForRun=new Uint16Array(a.length),this.kindForRun=new Uint8Array(a.length),this.colorForRun=fp(e,t,n),this.components=new Int32Array(o),this.pageBounds=new Float64Array(o*4),this.paintBounds=new Float64Array(a.length*4),this.heads=new Int32Array(o),this.tails=new Int32Array(o),this.next=new Int32Array(a.length),this.previousPaints=new Uint32Array(a.length),this.selectedPaints=new Uint8Array(a.length),this.allPaints=a.length>=sp?Array.from({length:a.length},(e,t)=>t):null;let s=0;for(let t=0;t<o;t++){let n=t*4,r=e.pageRects;s=Math.max(s,r[n+2]-r[n],r[n+3]-r[n+1])}this.paddingLimit=s>0&&a.length>=up?4*s/lp:1/0;let c=[0,0,0,0];a.forEach((t,n)=>{if(this.kindForRun[n]=ip.indexOf(t.kind),i){this.pageForRun[n]=i[n];return}this.bounds.getBounds(n,0,c);let r=(c[0]+c[2])*.5,a=(c[1]+c[3])*.5,s=0,l=1/0;for(let t=0;t<o;t++){let n=t*4,i=e.pageRects,o=Math.max(i[n]-r,0,r-i[n+2]),c=Math.max(i[n+1]-a,0,a-i[n+3]);o*o+c*c<l&&(s=t,l=o*o+c*c)}this.pageForRun[n]=s})}includeTextLod(e){this.textLodData!==e&&(this.textLodData=e,this.bounds.includeTextLod(e),this.padding=NaN,this.scheduleDirty=!0)}setColorCommutationEnabled(e){return this.colorCommutationEnabled!==e&&(this.colorCommutationEnabled=e,this.scheduleDirty=!0,!0)}updateScale(e){if(e===null||!Number.isFinite(e)||e<=0){let e=this.enabled;return this.enabled=!1,this.independentGroups=1,this.paintOrderApproximated=!1,e}let t=Math.max(.001,4*2**Math.ceil(Math.log2(Math.max(1e-6,e)))),n=Math.min(t,this.paddingLimit);if(this.paintOrderApproximated=n<t,this.enabled&&n===this.padding)return!1;this.enabled=!0,this.padding=n,this.scheduleDirty=!0;let r=this.components.length;for(let e=0;e<r;e++)this.pageBounds.set([1/0,1/0,-1/0,-1/0],e*4);let i=[0,0,0,0];for(let e=0;e<this.pageForRun.length;e++){let t=this.kindForRun[e],r=Math.max(.001,n*(t===0?.5:t<3?.125:1));if(this.bounds.getBounds(e,r,i),i.some(Number.isNaN)&&i.splice(0,4,-1/0,-1/0,1/0,1/0),this.paintBounds.set(i,e*4),i[0]>i[2]||i[1]>i[3])continue;let a=this.pageForRun[e]*4;this.pageBounds[a]=Math.min(this.pageBounds[a],i[0]),this.pageBounds[a+1]=Math.min(this.pageBounds[a+1],i[1]),this.pageBounds[a+2]=Math.max(this.pageBounds[a+2],i[2]),this.pageBounds[a+3]=Math.max(this.pageBounds[a+3],i[3])}let a=Int32Array.from({length:r},(e,t)=>t),o=e=>{for(;a[e]!==e;)a[e]=a[a[e]],e=a[e];return e};for(let e=0;!this.independentPages&&e<r;e++){let t=e*4,n=this.pageBounds;if(!(n[t]>n[t+2]||n[t+1]>n[t+3]))for(let r=0;r<e;r++){let i=r*4;if(n[i]>n[i+2]||n[i+1]>n[i+3]||n[t+2]<n[i]||n[i+2]<n[t]||n[t+3]<n[i+1]||n[i+3]<n[t+1])continue;let s=o(e),c=o(r);a[Math.max(s,c)]=Math.min(s,c)}}let s=new Set;for(let e=0;e<r;e++){let t=o(e);this.components[e]=t,s.add(t)}return this.independentGroups=s.size,!0}schedule(e){if(!this.enabled)return e;if(this.allPaints)return this.scheduleDirty&&(this.scheduleDirty=!1,this.schedulePaints(this.allPaints)),e.length===this.allPaints.length?this.compacted:this.filterSchedule(e);if(!this.scheduleDirty&&e.length<=this.previousPaintCount&&e.length>=this.previousPaintCount*cp){let t=0;for(let n=0;n<this.previousPaintCount&&t<e.length;n++)e[t]===this.previousPaints[n]&&t++;if(t===e.length)return e.length===this.previousPaintCount?this.compacted:this.filterSchedule(e)}return this.previousPaints.set(e),this.previousPaintCount=e.length,this.scheduleDirty=!1,this.schedulePaints(e)}filterSchedule(e){this.selectedPaints.fill(0);for(let t of e)this.selectedPaints[t]=1;this.filtered.length=0;for(let e of this.compacted)this.selectedPaints[e]&&this.filtered.push(e);return this.filtered}schedulePaints(e){if(this.compacted.length=0,!this.segments)return this.appendSchedule(e),this.compacted;for(let t=0;t<e.length;){let n=this.segments[e[t]];for(this.segmentRuns.length=0;t<e.length&&this.segments[e[t]]===n;)this.segmentRuns.push(e[t++]);this.appendSchedule(this.segmentRuns)}return this.compacted}appendSchedule(e){this.appendCompacted(this.independentGroups<=1?e:this.interleave(e))}interleave(e){this.heads.fill(-1),this.tails.fill(-1),this.ordered.length=0;for(let t of e){let e=this.components[this.pageForRun[t]];this.tails[e]<0?this.heads[e]=t:this.next[this.tails[e]]=t,this.tails[e]=t,this.next[t]=-1}let t=new Uint32Array(ip.length);for(;this.ordered.length<e.length;){t.fill(0);for(let e of this.heads)e>=0&&t[this.kindForRun[e]]++;let e=0;for(let n=1;n<t.length;n++)t[n]>t[e]&&(e=n);for(let t=0;t<this.heads.length;t++){let n=this.heads[t];for(;n>=0&&this.kindForRun[n]===e;)this.ordered.push(n),n=this.next[n];this.heads[t]=n}}return this.ordered}appendCompacted(e){this.colorCommutationEnabled&&(e=this.groupUniformColors(e));for(let t=0;t<e.length;t++)this.next[e[t]]=e[t+1]??-1;let t=e[0]??-1,n=Math.max(8192,e.length*op);for(;t>=0;){let e=this.kindForRun[t];if(this.compacted.push(t),t=this.next[t],e>=3)continue;let r=t,i=-1,a=0;for(;r>=0&&a<ap&&n>0;){let o=this.next[r],s=this.kindForRun[r]===e;if(s){for(let e=0;e<a;e++)if(n--<=0||this.dependsOn(r,this.skipped[e])){s=!1;break}}s?(this.compacted.push(r),i<0?t=o:this.next[i]=o):(this.skipped[a++]=r,i=r),r=o}}}groupUniformColors(e){this.colorGrouped.length=0;for(let t=0;t<e.length;){let n=this.colorForRun[e[t]],r=t+1;if(n>0)for(;r<e.length&&this.colorForRun[e[r]]===n;)r++;if(r===t+1)this.colorGrouped.push(e[t]);else for(let n=0;n<3;n++)for(let i=t;i<r;i++){let t=e[i];this.kindForRun[t]===n&&this.colorGrouped.push(t)}t=r}return this.colorGrouped}dependsOn(e,t){if(this.independentPages&&this.pageForRun[e]!==this.pageForRun[t])return!1;let n=this.colorForRun[e];return this.colorCommutationEnabled&&n>0&&n===this.colorForRun[t]?!1:this.overlaps(e,t)}overlaps(e,t){let n=e*4,r=t*4,i=this.paintBounds;return!(i[n]>i[n+2]||i[n+1]>i[n+3]||i[r]>i[r+2]||i[r+1]>i[r+3]||i[n+2]<i[r]||i[r+2]<i[n]||i[n+3]<i[r+1]||i[r+3]<i[n+1])}};function fp(e,t,n){let r=e.drawRuns,i=new Int32Array(r.length),a=new Float32Array(r.length*3),o=new Map,s=(e,t,n,r)=>{if(i[e]<0)return;let s=e*3;if(!Number.isFinite(t)||!Number.isFinite(n)||!Number.isFinite(r)){i[e]=-1;return}if(i[e]>0){(a[s]!==t||a[s+1]!==n||a[s+2]!==r)&&(i[e]=-1);return}a[s]=t,a[s+1]=n,a[s+2]=r;let c=`${t},${n},${r}`,l=o.get(c);l===void 0&&(l=o.size+1,o.set(c,l)),i[e]=l};r.forEach((t,n)=>{if(t.blendMode||t.kind!==`stroke`&&t.kind!==`fill`&&t.kind!==`text`){i[n]=-1;return}if(t.kind!==`stroke`)for(let r=t.first;r<t.first+t.count&&i[n]>=0;r++){let i=r*4;t.kind===`fill`?s(n,e.fillPathMetaB[i+2],e.fillPathMetaB[i+3],e.fillPathMetaC[i+2]):s(n,pp(e.textInstanceC[i]),pp(e.textInstanceC[i+1]),pp(e.textInstanceC[i+2]))}});for(let e of t.segments){let t=e.scene.styles;for(let r=0;r<e.count;r++){let i=r*4;s(n[e.first+r],t[i+1],t[i+2],t[i+3])}}return i}function pp(e){return Number.isFinite(e)?Math.fround(Math.round(Math.max(0,Math.min(1,e))*255)/255):NaN}var mp=class{culledCount=0;records;groupOffsets;groupAxes;candidates;candidateBits;sortedCandidateIds;sortedCandidateSlots;slotGroups;startRanks;selected;removed;visited;touched;groupCulled;coverage;activeSlots;previousSlots;previousCount=0;revision=0;constructor(e,t){this.records=t?Vi(t):Bi(e);let n=this.records.count,r=e.drawRuns??[{kind:`stroke`,first:0,count:e.segmentCount}],i=t?.sourceRuns??new Uint32Array(n).fill(4294967295);t||r.forEach((e,t)=>{e.kind===`stroke`&&i.fill(t,e.first,e.first+e.count)});let a=n?hp(e,this.records,i,r):new Uint32Array(r.length),o=[],s=[],c=new Map;if(!nc(e))for(let e of this.records.segments)for(let t=0;t<e.count;t++){let n=e.scene,l=e.first+t,u=t*4,d=r[i[l]];if(!d||a[i[l]]===0||n.primitiveMeta[u+2]!==0)continue;let f=n.primitiveMeta[u+3],p=Math.floor(f/2+1e-6),m=n.styles[u];if(!Number.isInteger(p)||p<0||p>7||f-p*2!=1||!Number.isFinite(m)||m<0)continue;let h=n.endpoints[u],g=n.endpoints[u+1],_=n.primitiveMeta[u],v=n.primitiveMeta[u+1];if(![h,g,_,v].every(Number.isFinite)||h===_&&g===v)continue;let y=_-h,b=v-g,x=Math.abs(y)>=Math.abs(b)?0:1,S=x===0?b/y:y/b,C=x===0?g-S*h:h-S*g,w=`${a[i[l]]},${d.clipIndex??-1},${p},${x},${S},${C}`;if(p&4){let e=n.primitiveBounds;if(![e[u],e[u+1],e[u+2],e[u+3]].every(Number.isFinite))continue;w+=`,${e[u]},${e[u+1]},${e[u+2]},${e[u+3]}`}let T=c.get(w);if(T===void 0)T=o.length,c.set(w,T),o.push([]),s.push(x);else{let e=o[T][0],t=Hi(this.records,e),n=(e-t.first)*4,r=t.scene,i=r.endpoints[n],a=r.endpoints[n+1],s=r.primitiveMeta[n]-i,c=r.primitiveMeta[n+1]-a;if((h-i)*c!==(g-a)*s||(_-i)*c!==(v-a)*s)continue}o[T].push(l)}let l=0,u=0,d=0;for(let e of o)e.length>1&&(l+=e.length,u++,d=Math.max(d,e.length));this.candidates=new Uint32Array(l),this.candidateBits=new Uint32Array(Math.ceil(n/32)),this.slotGroups=new Uint32Array(l),this.startRanks=new Uint32Array(l),this.selected=new Uint32Array(l),this.removed=new Uint8Array(l),this.groupOffsets=new Uint32Array(u+2),this.groupAxes=new Uint8Array(u+1),this.visited=new Uint32Array(u+1),this.touched=new Uint32Array(u),this.groupCulled=new Uint32Array(u+1),this.coverage=new Float64Array(d+1),this.activeSlots=new Uint32Array(l),this.previousSlots=new Uint32Array(l);let f=0,p=0;o.forEach((e,t)=>{if(e.length<2)return;p++;let n=s[t];this.groupAxes[p]=n,this.groupOffsets[p]=f,e.sort((e,t)=>this.start(e,n)-this.start(t,n));let r=new Map,a=0,o=-1/0;for(let t of e){let e=this.start(t,n);e!==o&&(a++,o=e),r.set(t,a)}let c=e=>{let t=Hi(this.records,e),n=t.scene,r=(e-t.first)*4;return Math.floor(n.primitiveMeta[r+3]/2+1e-6)&1?0:n.styles[r]};e.sort((e,t)=>c(t)-c(e)||this.start(e,n)-this.start(t,n)||this.end(t,n)-this.end(e,n)||i[t]-i[e]||t-e);for(let t of e)this.candidates[f]=t,this.slotGroups[f]=p,this.startRanks[f]=r.get(t),this.candidateBits[t>>>5]|=1<<(t&31),f++}),this.groupOffsets[p+1]=f;let m=Uint32Array.from({length:l},(e,t)=>t).sort((e,t)=>this.candidates[e]-this.candidates[t]);this.sortedCandidateIds=Uint32Array.from(m,e=>this.candidates[e]),this.sortedCandidateSlots=m}isCandidate(e){return!!(this.candidateBits[e>>>5]>>>(e&31)&1)}get candidateCount(){return this.candidates.length}update(e,t=e.length){let n=this.revision;++this.revision>4294967295&&(this.revision=1,this.selected.fill(0),this.removed.fill(0),this.visited.fill(0),this.groupCulled.fill(0),this.previousCount=0,this.culledCount=0,n=0);let r=0,i=0;for(let a=0;a<t;a++){let t=e[a];if(!this.isCandidate(t))continue;let o=this.slotOf(t),s=this.slotGroups[o];if(this.selected[o]===this.revision)continue;let c=n===0||this.selected[o]!==n;this.selected[o]=this.revision,this.activeSlots[i++]=o,c&&this.visited[s]!==this.revision&&(this.visited[s]=this.revision,this.touched[r++]=s)}for(let e=0;e<this.previousCount;e++){let t=this.previousSlots[e];if(this.selected[t]===this.revision)continue;let n=this.slotGroups[t];this.visited[n]!==this.revision&&(this.visited[n]=this.revision,this.touched[r++]=n)}let a=this.previousSlots;this.previousSlots=this.activeSlots,this.activeSlots=a,this.previousCount=i;for(let e=0;e<r;e++){let t=this.touched[e],n=this.groupAxes[t],r=this.groupOffsets[t],i=this.groupOffsets[t+1],a=i-r;this.culledCount-=this.groupCulled[t];let o=0;this.coverage.fill(-1/0,0,a+1);for(let e=r;e<i;e++){if(this.removed[e]=0,this.selected[e]!==this.revision)continue;let t=this.startRanks[e],r=this.end(this.candidates[e],n),i=-1/0;for(let e=t;e>0;e-=e&-e)i=Math.max(i,this.coverage[e]);if(i>=r)this.removed[e]=1,o++;else for(let e=t;e<=a;e+=e&-e)this.coverage[e]=Math.max(this.coverage[e],r)}this.groupCulled[t]=o,this.culledCount+=o}}isRetained(e){return!this.isCandidate(e)||this.removed[this.slotOf(e)]!==1}slotOf(e){let t=this.sortedCandidateIds,n=0,r=t.length-1;for(;n<r;){let i=n+r>>>1;t[i]<e?n=i+1:r=i}return this.sortedCandidateSlots[n]}start(e,t){let n=Hi(this.records,e),r=(e-n.first)*4+t;return Math.min(n.scene.endpoints[r],n.scene.primitiveMeta[r])}end(e,t){let n=Hi(this.records,e),r=(e-n.first)*4+t;return Math.max(n.scene.endpoints[r],n.scene.primitiveMeta[r])}};function hp(e,t,n,r){let i=Array(r.length).fill(void 0),a=(e,t,n,r)=>{if(i[e]===null)return;if(![t,n,r].every(Number.isFinite)){i[e]=null;return}let a=`${t},${n},${r}`;i[e]===void 0?i[e]=a:i[e]!==a&&(i[e]=null)};r.forEach((t,n)=>{if(t.blendMode||t.kind!==`stroke`&&t.kind!==`fill`&&t.kind!==`text`){i[n]=null;return}if(t.kind!==`stroke`)for(let r=t.first;r<t.first+t.count&&i[n]!==null;r++){let i=r*4;t.kind===`fill`?a(n,e.fillPathMetaB[i+2],e.fillPathMetaB[i+3],e.fillPathMetaC[i+2]):a(n,gp(e.textInstanceC[i]),gp(e.textInstanceC[i+1]),gp(e.textInstanceC[i+2]))}});for(let e of t.segments){let t=e.scene.styles;for(let i=0;i<e.count;i++){let o=n[e.first+i];r[o]?.kind===`stroke`&&a(o,t[i*4+1],t[i*4+2],t[i*4+3])}}let o=new Uint32Array(r.length),s=0,c;return i.forEach((e,t)=>{(e!==c||!e)&&s++,e&&(o[t]=s),c=e}),o}function gp(e){return Number.isFinite(e)?Math.fround(Math.round(Math.max(0,Math.min(1,e))*255)/255):NaN}var _p=class{ranges;data;instanceIds=new Uint32Array;revision=0;paints;coarsePaints;exactCount;counts;cursors;selectedPaints=new Uint32Array;constructor(e,t){this.data=t;let n=e.drawRuns??[];this.paints=n.flatMap((e,t)=>e.kind===`text`?[{first:e.first,end:e.first+e.count,index:t}]:[]).sort((e,t)=>e.first-t.first),this.exactCount=t.exactInstanceCount,this.ranges=new Uint32Array(n.length*2),this.counts=new Uint32Array(n.length),this.cursors=new Uint32Array(n.length),this.coarsePaints=new Uint32Array(t.coarseInstanceCount);for(let e of t.runs){if(e.coarseIndex<0)continue;let t=this.paintAt(e.exactStart);if(e.exactStart+e.exactCount>t.end)throw Error(`Text LOD crosses a PDF paint boundary.`);this.coarsePaints[e.coarseIndex]=t.index}}update(e){if(this.revision&&!e.changed)return;let t=e.instanceIds;this.instanceIds.length<t.length&&(this.instanceIds=new Uint32Array(t.length),this.selectedPaints=new Uint32Array(t.length)),this.counts.fill(0);let n=this.paints[0];for(let e=0;e<t.length;e++){let r=t[e];r<this.exactCount&&(!n||r<n.first||r>=n.end)&&(n=this.paintAt(r));let i=r<this.exactCount?n.index:this.coarsePaints[r-this.exactCount];this.selectedPaints[e]=i,this.counts[i]++}let r=0;for(let e=0;e<this.counts.length;e++)this.ranges[e*2]=this.cursors[e]=r,this.ranges[e*2+1]=this.counts[e],r+=this.counts[e];for(let e=0;e<t.length;e++)this.instanceIds[this.cursors[this.selectedPaints[e]]++]=t[e];this.revision++}paintAt(e){let t=0,n=this.paints.length;for(;t<n;){let r=t+n>>>1;this.paints[r].end<=e?t=r+1:n=r}let r=this.paints[t];if(!r||e<r.first)throw Error(`Text LOD glyph has no PDF paint.`);return r}},vp=64,yp=4,bp=.35,xp=1024,Sp=3e4,Cp=22e4;function wp(e,t,n){let r=t*4,i=e.styles[r],a=i+bp,o=e.primitiveBounds;n.minX=o[r]-a,n.minY=o[r+1]-a,n.maxX=o[r+2]+a,n.maxY=o[r+3]+a;let s=e.primitiveMeta;if((Math.floor(s[r+3]/2+1e-6)&yp)===0)return!0;let c=e.endpoints,l=Math.SQRT2*Math.max(0,i)+bp;return n.minX=Math.max(n.minX,Math.min(c[r],c[r+2],s[r])-l),n.minY=Math.max(n.minY,Math.min(c[r+1],c[r+3],s[r+1])-l),n.maxX=Math.min(n.maxX,Math.max(c[r],c[r+2],s[r])+l),n.maxY=Math.min(n.maxY,Math.max(c[r+1],c[r+3],s[r+1])+l),n.minX<=n.maxX&&n.minY<=n.maxY}function Tp(e){let t=e.segmentCount,n=Math.max(e.bounds.maxX-e.bounds.minX,1e-5),r=Math.max(e.bounds.maxY-e.bounds.minY,1e-5),{gridWidth:i,gridHeight:a}=Ep(t,n,r),o=i*a,s=n/i,c=r/a,l=new Uint32Array(o),u=0,d={minX:0,minY:0,maxX:0,maxY:0};for(let n=0;n<t;n+=1){if(!wp(e,n,d))continue;let t=Dp(Math.floor((d.minX-e.bounds.minX)/s),i),r=Dp(Math.floor((d.maxX-e.bounds.minX)/s),i),o=Dp(Math.floor((d.minY-e.bounds.minY)/c),a),f=Dp(Math.floor((d.maxY-e.bounds.minY)/c),a);for(let e=o;e<=f;e+=1){let n=e*i+t;for(let e=t;e<=r;e+=1){let e=l[n]+1;l[n]=e,e>u&&(u=e),n+=1}}}let f=new Uint32Array(o+1);for(let e=0;e<o;e+=1)f[e+1]=f[e]+l[e];let p=f[o],m=new Uint32Array(p),h=f.slice(0,o);for(let n=0;n<t;n+=1){if(!wp(e,n,d))continue;let t=Dp(Math.floor((d.minX-e.bounds.minX)/s),i),r=Dp(Math.floor((d.maxX-e.bounds.minX)/s),i),o=Dp(Math.floor((d.minY-e.bounds.minY)/c),a),l=Dp(Math.floor((d.maxY-e.bounds.minY)/c),a);for(let e=o;e<=l;e+=1){let a=e*i+t;for(let e=t;e<=r;e+=1){let e=h[a];m[e]=n,h[a]=e+1,a+=1}}}return{gridWidth:i,gridHeight:a,minX:e.bounds.minX,minY:e.bounds.minY,maxX:e.bounds.maxX,maxY:e.bounds.maxY,cellWidth:s,cellHeight:c,offsets:f,counts:l,indices:m,maxCellPopulation:u}}function Ep(e,t,n){let r=Op(Math.round(e/8),Sp,Cp),i=t/n,a=Math.round(Math.sqrt(r*i)),o=Math.round(r/Math.max(a,1));return a=Op(a,vp,xp),o=Op(o,vp,xp),{gridWidth:a,gridHeight:o}}function Dp(e,t){return e<0?0:e>=t?t-1:e}function Op(e,t,n){return e<t?t:e>n?n:e}function kp(e,t,n){let r=[],i=Math.max(1,Math.trunc(t)),a=Math.max(1,Math.trunc(n)),o=e;for(r.push({width:i,height:a,data:o});i>1||a>1;){let e=Math.max(1,i>>1),t=Math.max(1,a>>1),n=new Uint8Array(e*t);for(let r=0;r<t;r+=1){let t=Math.min(a-1,r*2),s=Math.min(a-1,t+1);for(let a=0;a<e;a+=1){let c=Math.min(i-1,a*2),l=Math.min(i-1,c+1),u=t*i+c,d=t*i+l,f=s*i+c,p=s*i+l;n[r*e+a]=o[u]+o[d]+o[f]+o[p]+2>>2}}r.push({width:e,height:t,data:n}),i=e,a=t,o=n}return r}var Ap=4096,jp=96,Mp=[1,.85,.7,.55,.4,.3],Np=8,Pp=256,Fp=8,Ip=.001;function Lp(e,t){if(typeof document>`u`||e.textGlyphCount<=0)return null;let n=new Float32Array(e.textGlyphCount*4),r=Up(Math.trunc(t)||4096,256,Ap),i=null;for(let t of Mp){let n=Rp(e,Math.max(Np,Math.round(jp*t)));if(n.length===0)return null;let a=zp(n,r);if(a){i=a;break}}if(!i)return null;let a=document.createElement(`canvas`);a.width=i.width,a.height=i.height;let o=a.getContext(`2d`,{alpha:!0,willReadFrequently:!0});if(!o)return null;o.setTransform(1,0,0,1,0,0),o.clearRect(0,0,i.width,i.height),o.fillStyle=`#ffffff`,o.globalCompositeOperation=`source-over`;for(let t of i.placements){if(!Bp(o,t,e))continue;o.fill(`nonzero`);let r=t.index*4;n[r]=(t.x+Fp)/i.width,n[r+1]=(t.y+Fp)/i.height,n[r+2]=t.innerWidth/i.width,n[r+3]=t.innerHeight/i.height}let s=o.getImageData(0,0,i.width,i.height),c=new Uint8Array(i.width*i.height);for(let e=0,t=0;t<c.length;e+=4,t+=1)c[t]=s.data[e+3];return{width:i.width,height:i.height,alpha:c,glyphUvRects:n}}function Rp(e,t){let n=[];for(let r=0;r<e.textGlyphCount;r+=1){let i=r*4,a=Math.max(0,Math.trunc(e.textGlyphMetaA[i])),o=Math.max(0,Math.trunc(e.textGlyphMetaA[i+1]));if(o<=0)continue;let s=e.textGlyphMetaA[i+2],c=e.textGlyphMetaA[i+3],l=e.textGlyphMetaB[i],u=e.textGlyphMetaB[i+1],d=l-s,f=u-c;if(!Number.isFinite(d)||!Number.isFinite(f)||d<=1e-6||f<=1e-6)continue;let p=t/Math.max(d,f),m=Up(Math.ceil(d*p),Np,Pp),h=Up(Math.ceil(f*p),Np,Pp);n.push({index:r,segmentStart:a,segmentCount:o,minX:s,minY:c,maxX:l,maxY:u,innerWidth:m,innerHeight:h,tileWidth:m+Fp*2,tileHeight:h+Fp*2,x:0,y:0})}return n}function zp(e,t){if(e.length===0)return null;let n=e.slice().sort((e,t)=>e.tileHeight===t.tileHeight?t.tileWidth-e.tileWidth:t.tileHeight-e.tileHeight),r=n.reduce((e,t)=>e+t.tileWidth*t.tileHeight,0),i=n.reduce((e,t)=>Math.max(e,t.tileWidth),0),a=Up(Hp(Math.ceil(Math.sqrt(r)*1.15)),i,t);for(;a<=t;){let e=0,r=0,i=0,o=!1;for(let s of n){if(s.tileWidth>a){o=!0;break}if(e+s.tileWidth>a&&(e=0,r+=i,i=0),s.x=e,s.y=r,e+=s.tileWidth,i=Math.max(i,s.tileHeight),r+i>t){o=!0;break}}if(!o){let e=r+i,o=Up(Hp(Math.max(e,1)),1,t);if(o<=t)return{placements:n,width:a,height:o}}if(a===t)break;a=Math.min(t,a*2)}return null}function Bp(e,t,n){let r=Math.max(t.maxX-t.minX,1e-6),i=Math.max(t.maxY-t.minY,1e-6),a=t.innerWidth/r,o=t.innerHeight/i,s=t.x+Fp-t.minX*a,c=t.y+Fp+t.maxY*o,l=e=>s+e*a,u=e=>c-e*o;e.beginPath();let d=!1,f=!1,p=0,m=0,h=0,g=0;for(let r=0;r<t.segmentCount;r+=1){let i=(t.segmentStart+r)*4;if(i+3>=n.textGlyphSegmentsA.length||i+3>=n.textGlyphSegmentsB.length)break;let a=n.textGlyphSegmentsA[i],o=n.textGlyphSegmentsA[i+1],s=n.textGlyphSegmentsA[i+2],c=n.textGlyphSegmentsA[i+3],_=n.textGlyphSegmentsB[i],v=n.textGlyphSegmentsB[i+1],y=n.textGlyphSegmentsB[i+2];(!f||!Vp(a,o,h,g))&&(f&&e.closePath(),e.moveTo(l(a),u(o)),f=!0,p=a,m=o),y>=.5?e.quadraticCurveTo(l(s),u(c),l(_),u(v)):e.lineTo(l(_),u(v)),d=!0,h=_,g=v,Vp(h,g,p,m)&&(e.closePath(),f=!1)}return f&&e.closePath(),d}function Vp(e,t,n,r){return Math.abs(e-n)<=Ip&&Math.abs(t-r)<=Ip}function Hp(e){if(e<=1)return 1;let t=1;for(;t<e;)t<<=1;return t}function Up(e,t,n){return e<t?t:e>n?n:e}function Wp(e){let t=null,n=!1,r=0,i=0,a=new Set,o=new Map,s=null,c=!1,l=0,u=0,d=0;function f(){n=!1,r=0,i=0,a.clear(),o.clear(),s=null,c=!1,l=0,u=0,d=0}function p(){o.clear(),s=null,c=!1,l=0,u=0,d=0}function m(t){t&&n&&e().endPanInteraction(),p(),f()}function h(){if(o.size<2)return null;let e=o.values(),t=e.next().value,n=e.next().value;if(!t||!n)return null;let r=n.x-t.x,i=n.y-t.y;return{distance:Math.hypot(r,i),centerX:(t.x+n.x)*.5,centerY:(t.y+n.y)*.5}}function g(e,t){if(e.hasPointerCapture(t))try{e.releasePointerCapture(t)}catch{}}function _(t){if(!o.has(t.pointerId)||!n)return;o.set(t.pointerId,{x:t.clientX,y:t.clientY});let a=e();if(o.size>=2){let e=h();if(!e)return;if(!c){c=!0,s=null,l=Math.max(e.distance,.001),u=e.centerX,d=e.centerY;return}let t=Math.max(l,.001),n=Math.max(e.distance,.001),r=n/t,i=e.centerX-u,o=e.centerY-d;(i!==0||o!==0)&&a.panByPixels(i,o),Number.isFinite(r)&&Math.abs(r-1)>1e-4&&a.zoomAtClientPoint(e.centerX,e.centerY,r),l=n,u=e.centerX,d=e.centerY;return}if(s===null){s=t.pointerId,r=t.clientX,i=t.clientY,c=!1,l=0;return}if(t.pointerId!==s)return;let f=t.clientX-r,p=t.clientY-i;r=t.clientX,i=t.clientY,a.panByPixels(f,p)}function v(e,t){if(o.delete(t.pointerId),a.delete(t.pointerId),g(e,t.pointerId),o.size>=2){let e=h();e&&(c=!0,s=null,l=Math.max(e.distance,.001),u=e.centerX,d=e.centerY);return}if(o.size===1){let e=o.entries().next().value;e?(s=e[0],r=e[1].x,i=e[1].y):s=null,c=!1,l=0,u=0,d=0;return}m(!0)}let y=f=>{let p=t;if(p){if(a.add(f.pointerId),n||(n=!0,e().beginPanInteraction()),f.pointerType===`touch`){if(o.set(f.pointerId,{x:f.clientX,y:f.clientY}),o.size===1)s=f.pointerId,c=!1,l=0,u=f.clientX,d=f.clientY,r=f.clientX,i=f.clientY;else{let e=h();e&&(c=!0,s=null,l=Math.max(e.distance,.001),u=e.centerX,d=e.centerY)}}else r=f.clientX,i=f.clientY;p.setPointerCapture(f.pointerId)}},b=t=>{if(t.pointerType===`touch`){_(t);return}if(!n)return;let a=t.clientX-r,o=t.clientY-i;r=t.clientX,i=t.clientY,e().panByPixels(a,o)},x=e=>{let n=t;if(n){if(e.pointerType===`touch`){v(n,e);return}a.delete(e.pointerId),m(!0),g(n,e.pointerId)}},S=e=>{let n=t;if(n){if(e.pointerType===`touch`){v(n,e);return}a.delete(e.pointerId),m(!0),g(n,e.pointerId)}},C=e=>{if(a.delete(e.pointerId),e.pointerType===`touch`){o.has(e.pointerId)&&o.delete(e.pointerId),o.size===0&&m(!0);return}n&&m(!0)},w=t=>{t.preventDefault();let n=Math.exp(-t.deltaY*.0013);e().zoomAtClientPoint(t.clientX,t.clientY,n)};function T(e){t!==e&&(t&&E(),t=e,e.addEventListener(`pointerdown`,y),e.addEventListener(`pointermove`,b),e.addEventListener(`pointerup`,x),e.addEventListener(`pointercancel`,S),e.addEventListener(`lostpointercapture`,C),e.addEventListener(`wheel`,w,{passive:!1}))}function E(){let e=t;if(e){for(let t of a)g(e,t);e.removeEventListener(`pointerdown`,y),e.removeEventListener(`pointermove`,b),e.removeEventListener(`pointerup`,x),e.removeEventListener(`pointercancel`,S),e.removeEventListener(`lostpointercapture`,C),e.removeEventListener(`wheel`,w),t=null,m(!0)}}function D(){let e=t;if(e)for(let t of a)g(e,t);m(!0)}return{attach:T,detach:E,resetState:f,cancelActiveGesture:D}}var Gp=/^[a-z][a-z\d+.-]*:/i;function Kp(e){let t=e.trim();if(Gp.test(t))return t;let n=t.replace(/^\/+/,``),r=new URL(`./`,window.location.href);return new URL(n,r).toString()}function qp(e){let t=Array.isArray(e.examples)?e.examples:[],n=[];for(let e=0;e<t.length;e+=1){let r=t[e],i=Yp(r?.name);if(!i)continue;let a=Yp(r?.id)??`example-${e+1}`,o=Yp(r?.pdf?.path),s=Yp(r?.hep?.path),c=o?Kp(o):null,l=s?Kp(s):null;c&&l&&n.push({id:a,name:i,pdfPath:c,pdfSizeBytes:Jp(r?.pdf?.sizeBytes,0),...Yp(r?.hepLod?.path)?{hepLodPath:Kp(r.hepLod.path),hepLodSizeBytes:Jp(r.hepLod?.sizeBytes,0)}:{},hepPath:l,hepSizeBytes:Jp(r?.hep?.sizeBytes,0)})}return n}function Jp(e,t){let n=Number(e);return Number.isFinite(n)?Math.max(0,Math.trunc(n)):Math.max(0,Math.trunc(t))}function Yp(e){if(typeof e!=`string`)return null;let t=e.trim();return t.length>0?t:null}var Xp=16,Zp=6;function Qp(e){let{containerElement:t,triggerElement:n,labelElement:r,menuElement:i,onSelect:a,signal:o}=e,s=o?{signal:o}:void 0,c=!1,l=!1,u=!1;i.tabIndex=-1,document.body.append(i);function d(e){return t.contains(e)||i.contains(e)}function f(){let e=l||!c;n.disabled=e,e&&m()}function p(){u||n.disabled||(u=!0,i.hidden=!1,h(),t.classList.add(`open`),n.setAttribute(`aria-expanded`,`true`),i.focus({preventScroll:!0}))}function m(e=!1){u&&(u=!1,i.hidden=!0,t.classList.remove(`open`),n.setAttribute(`aria-expanded`,`false`),e&&n.focus())}function h(){let e=n.getBoundingClientRect();i.style.minWidth=`${Math.round(e.width)}px`,i.style.top=`${Math.round(e.bottom+Zp)}px`,i.style.left=`${Math.round(e.left)}px`;let t=window.innerHeight-e.bottom-Zp-Xp;i.style.maxHeight=`${Math.max(160,t)}px`;let r=i.getBoundingClientRect(),a=r.right-(window.innerWidth-Xp);a>0&&(i.style.left=`${Math.max(Xp,Math.round(r.left-a))}px`)}function g(){return Array.from(i.querySelectorAll(`button.example-chip`))}function _(e){let t=g();if(t.length===0)return;let n=t.indexOf(document.activeElement);t[n===-1?e>0?0:t.length-1:(n+e+t.length)%t.length].focus()}n.addEventListener(`click`,()=>{u?m():p()},s),n.addEventListener(`keydown`,e=>{(e.key===`ArrowDown`||e.key===`ArrowUp`)&&(e.preventDefault(),p(),_(e.key===`ArrowDown`?1:-1))},s),i.addEventListener(`keydown`,e=>{if(e.key===`Escape`)e.preventDefault(),m(!0);else if(e.key===`ArrowDown`||e.key===`ArrowUp`)e.preventDefault(),_(e.key===`ArrowDown`?1:-1);else if(e.key===`Home`||e.key===`End`){e.preventDefault();let t=g();t[e.key===`Home`?0:t.length-1]?.focus()}},s);let v=e=>{let t=e.relatedTarget;t instanceof Node&&d(t)||m()};t.addEventListener(`focusout`,v,s),i.addEventListener(`focusout`,v,s),document.addEventListener(`pointerdown`,e=>{u&&e.target instanceof Node&&!d(e.target)&&m()},s),window.addEventListener(`resize`,()=>{m()},s),window.addEventListener(`scroll`,e=>{u&&e.target instanceof Node&&!i.contains(e.target)&&m()},{capture:!0,passive:!0,...o?{signal:o}:{}});function y(e){c=!1,r.textContent=e,i.replaceChildren(),f()}function b(e){if(c=e.length>0,r.replaceChildren(),r.append(`Examples`),c){let t=document.createElement(`span`);t.className=`example-trigger-count`,t.textContent=String(e.length),r.append(t)}let t=[];for(let n of e){let e=document.createElement(`div`);e.className=`example-menu-row`;let r=document.createElement(`span`);r.className=`example-menu-name`,r.textContent=n.name,r.title=n.name,e.append(r);let i=document.createElement(`div`);i.className=`example-menu-actions`;for(let e of n.actions){let t=document.createElement(`button`);t.type=`button`,t.className=`example-chip`,t.title=e.title;let n=document.createElement(`span`);n.className=`example-chip-kind`,n.textContent=e.label;let r=document.createElement(`span`);r.className=`example-chip-size`,r.textContent=e.sizeLabel,t.append(n,r),t.addEventListener(`click`,()=>{m(),a(e.key)}),i.append(t)}e.append(i),t.push(e)}i.replaceChildren(...t),f()}function x(e){l=e,f()}return{setPlaceholder:y,setItems:b,setDisabled:x,close:()=>m()}}var $p=.12,em=$p*.5,tm=.5,nm=.5,rm=.98,im=4;function am(e,t,n,r,i){let a=t.charInstance[n];if(a===-1||a===void 0)return!1;if(a<=-2){let e=(-a-2)*4,n=t.fallbackQuads;return e+3>=n.length?!1:(r[i]=n[e],r[i+1]=n[e+1],r[i+2]=n[e+2],r[i+3]=n[e+3],!0)}let o=e.textInstanceA,s=e.textInstanceB,c=e.textGlyphMetaA,l=e.textGlyphMetaB,u=a*4;if(u+3>=o.length||u+3>=s.length)return!1;let d=o[u],f=o[u+1],p=o[u+2],m=o[u+3],h=s[u],g=s[u+1],_=Math.trunc(s[u+2])*4;if(_<0||_+3>=c.length||_+1>=l.length)return!1;let v=c[_+2],y=c[_+3],b=l[_],x=l[_+1],S=d*v+p*y+h,C=f*v+m*y+g,w=d*v+p*x+h,T=f*v+m*x+g,E=d*b+p*y+h,D=f*b+m*y+g,O=d*b+p*x+h,k=f*b+m*x+g;r[i]=Math.min(S,w,E,O),r[i+1]=Math.min(C,T,D,k),r[i+2]=Math.max(S,w,E,O),r[i+3]=Math.max(C,T,D,k);let A=Math.trunc(s[u+3]),j=(A-1)*4;return!(A>0&&e.textClipRects&&j+3<e.textClipRects.length&&(r[i]=Math.max(r[i],e.textClipRects[j]),r[i+1]=Math.max(r[i+1],e.textClipRects[j+1]),r[i+2]=Math.min(r[i+2],e.textClipRects[j+2]),r[i+3]=Math.min(r[i+3],e.textClipRects[j+3]),r[i]>r[i+2]||r[i+1]>r[i+3]))}var om=new Float32Array(4),sm=new Float64Array(4);function cm(e,t,n,r){let i=t.charInstance[n];if(i===void 0||i<0)return!1;let a=i*4;if(a+1>=e.textInstanceA.length||a+1>=e.textInstanceB.length)return!1;let o=e.textInstanceA[a],s=e.textInstanceA[a+1],c=Math.hypot(o,s);return!Number.isFinite(c)||c<=1e-12?!1:(r[0]=e.textInstanceB[a],r[1]=e.textInstanceB[a+1],r[2]=o/c,r[3]=s/c,Number.isFinite(r[0])&&Number.isFinite(r[1]))}function lm(e,t,n){return t*(t>=0?e.minX:e.maxX)+n*(n>=0?e.minY:e.maxY)}function um(e,t,n){return t*(t>=0?e.maxX:e.minX)+n*(n>=0?e.maxY:e.minY)}function dm(e,t,n){return um(e,t,n)-lm(e,t,n)}function fm(e,t,n,r){return Math.min(t,r)-Math.max(e,n)>=Math.min(t-e,r-n)*tm}function pm(e,t,n,r){return fm(lm(e,n,r),um(e,n,r),lm(t,n,r),um(t,n,r))}function mm(e,t,n){if(n)return!1;if(pm(e,t,1,0)||pm(e,t,0,1))return!0;let r=(t.minX+t.maxX-e.minX-e.maxX)*.5,i=(t.minY+t.maxY-e.minY-e.maxY)*.5,a=Math.hypot(e.maxX-e.minX,e.maxY-e.minY),o=Math.hypot(t.maxX-t.minX,t.maxY-t.minY);return Math.hypot(r,i)<=Math.max(a,o,1e-6)*im}function hm(e,t,n,r){let i=e.maxX-e.minX,a=e.maxY-e.minY;if(i<=0||a<=0){let t=.5;return{minX:e.minX-t,minY:e.minY-t,maxX:e.maxX+t,maxY:e.maxY+t}}let o,s;if(t!==null&&n!==null&&Number.isFinite(r)&&r>0){let e=-n,i=t,a=r*em,c=r*$p;o=Math.abs(t)*a+Math.abs(e)*c,s=Math.abs(n)*a+Math.abs(i)*c}else s=a*$p,o=a*em;return{minX:e.minX-o,minY:e.minY-s,maxX:e.maxX+o,maxY:e.maxY+s}}function gm(e,t,n,r){let i=[],a=null,o=null,s=!1,c=!1,l=0,u=0,d=0,f=0,p=0,m=0,h=!1,g=(e,t)=>{s=!0,c=!0,l=sm[2],u=sm[3];let n=-u,r=l;d=n*sm[0]+r*sm[1],f=lm(e,n,r),p=um(e,n,r),m=dm(e,n,r),t&&(f=Math.min(f,lm(t,n,r)),p=Math.max(p,um(t,n,r)),m=Math.max(m,dm(t,n,r)))},_=(e,t)=>{let n=(t.minX+t.maxX-e.minX-e.maxX)*.5,r=(t.minY+t.maxY-e.minY-e.maxY)*.5,i=Math.hypot(n,r);if(!Number.isFinite(i)||i<=1e-12)return;s=!0,c=!1,l=n/i,u=r/i;let a=-u,o=l;f=Math.min(lm(e,a,o),lm(t,a,o)),p=Math.max(um(e,a,o),um(t,a,o)),m=Math.max(dm(e,a,o),dm(t,a,o))},v=e=>{let t=-u,n=l;f=Math.min(f,lm(e,t,n)),p=Math.max(p,um(e,t,n)),m=Math.max(m,dm(e,t,n))},y=()=>{a&&(i.push(hm(a,s?l:null,s?u:null,m)),a=null,o=null,s=!1,c=!1,m=0)},b=Math.min(n+r,t.charInstance.length);for(let r=Math.max(0,n);r<b;r+=1){if(!am(e,t,r,om,0)){t.charInstance[r]===-1&&(h=!0);continue}let n=om[0],i=om[1],b=om[2],x=om[3],S={minX:n,minY:i,maxX:b,maxY:x},C=cm(e,t,r,sm);if(a){let e;if(s){let t=-u,n=l,r=lm(S,t,n),i=um(S,t,n);if(C){let a=Math.abs(sm[2]*l+sm[3]*u);if(c){let o=t*sm[0]+n*sm[1],s=i-r,c=Math.min(s,m)*nm;e=a>=rm&&Math.abs(o-d)<=c}else e=a>=rm&&fm(f,p,r,i)}else e=fm(f,p,r,i)}else e=o!==null&&mm(o,S,h);e||y()}if(!a){a=S,o=S,C&&g(S,null),h=!1;continue}s?v(S):C?g(S,o):o&&_(o,S),a.minX=Math.min(a.minX,n),a.minY=Math.min(a.minY,i),a.maxX=Math.max(a.maxX,b),a.maxY=Math.max(a.maxY,x),o=S,h=!1}return y(),i}var _m=new WeakMap;function vm(e,t,r,i){if(!e.optionalContent&&!e.paintGraph)return!0;!i&&e.optionalContent&&(i=_m.get(e),i||_m.set(e,i=n(e)));let a=e=>e===void 0||e<0||!i||i.conditions[e]===1,o=t.charInstance[r];if(e.paintGraph&&o>=0&&!Er(e,{kind:`text`,index:o},a))return!1;let s=t.optionalContent?.[r];return s===void 0&&(s=o>=0?Tr(e,{kind:`text`,index:o}):void 0),a(s)}var ym=5e3,bm=96,xm=40,Sm=12;function Cm(e){return e.highlightBounds&&e.highlightBounds.length>0?e.highlightBounds:[e.bounds]}function wm(e,t=-1){let n=t>=0&&t<e.length?t:-1,r=[],i=-1,a=0;for(let t=0;t<e.length;t+=1){let o=Cm(e[t]);t===n&&(i=r.length,a=o.length),r.push(...o)}return{bounds:r,currentIndex:i,currentCount:a}}function Tm(e,t=-1){if(e.length===0)return null;let n=wm(e,t),r=n.bounds.length;if(r===0)return null;let i=new Float32Array(r*4);for(let e=0;e<r;e+=1){let t=n.bounds[e],r=e*4;i[r]=t.minX,i[r+1]=t.minY,i[r+2]=t.maxX,i[r+3]=t.maxY}return{rects:i,count:r,currentIndex:n.currentIndex,currentCount:n.currentCount}}function Em(e){if(e.length===0)return{minX:0,minY:0,maxX:0,maxY:0};let t=e[0].minX,n=e[0].minY,r=e[0].maxX,i=e[0].maxY;for(let a=1;a<e.length;a+=1)t=Math.min(t,e[a].minX),n=Math.min(n,e[a].minY),r=Math.max(r,e[a].maxX),i=Math.max(i,e[a].maxY);return{minX:t,minY:n,maxX:r,maxY:i}}function Dm(e){let t=e.textIndex?.pages??[],n=t.some(e=>e.text.length>0),r=null,i=()=>(r||=t.map(e=>km(e.text)),r);return{hasText:n,search(r,a={}){let o=[];if(!n)return o;let s=a.caseSensitive===!0,c=Math.max(1,a.maxMatches??ym),l=r.replace(/\s+/g,` `);if(l.trim().length===0)return o;let u=s?l:km(l),d=s?t.map(e=>e.text):i();for(let n=0;n<d.length;n+=1){let r=d[n];if(r.length<u.length)continue;let i=0;for(;o.length<c;){let s=r.indexOf(u,i);if(s<0)break;let c=!0;for(let r=s;r<s+u.length;r++)if(!vm(e,t[n],r,a.optionalContent)){c=!1;break}if(!c){i=s+Math.max(1,u.length);continue}let l=gm(e,t[n],s,u.length);o.push({pageIndex:n,startChar:s,length:u.length,bounds:Em(l),highlightBounds:l}),i=s+u.length}if(o.length>=c)break}return o}}}function Om(e){let t=null,n=!1,r=!1,i=``,a=!1,o=[],s=!1,c=-1,l=()=>({hasScene:n,hasTextIndex:r,query:i,caseSensitive:a,matchCount:o.length,matchCountCapped:s,currentIndex:c}),u=()=>{e.onStateChange(l()),e.onMatchesChange(c>=0?o[c]:null,o)},d=()=>{o=t?t.search(i,{caseSensitive:a,maxMatches:ym,optionalContent:e.getRenderer()?.getOptionalContentVisibility?.()}):[],s=o.length>=ym},f=()=>{if(o.length===0)return-1;let t=e.getRenderer();if(!t)return 0;let n=t.getViewState(),r=0,i=1/0;for(let e=0;e<o.length;e+=1){let t=o[e].bounds,a=(t.minX+t.maxX)*.5-n.cameraCenterX,s=(t.minY+t.maxY)*.5-n.cameraCenterY,c=a*a+s*s;c<i&&(i=c,r=e)}return r},p=t=>{let n=e.getRenderer(),r=e.getCanvas();if(!n||!r)return;let i=t.bounds,a=window.devicePixelRatio||1,o=Math.max(i.maxX-i.minX,1e-4),s=Math.max(i.maxY-i.minY,1e-4),c=bm*a,l=Math.max(1,r.width-c*2),u=Math.max(1,r.height-c*2),d=Math.min(l/o,u/s),f=xm*a/s,p=Math.min(d,f),m=n.getViewState(),h=o*m.zoom<=l&&s*m.zoom<=u,g=s*m.zoom/a>=Sm,_=h&&g?m.zoom:p;n.setViewState({cameraCenterX:(i.minX+i.maxX)*.5,cameraCenterY:(i.minY+i.maxY)*.5,zoom:_})},m=e=>{d(),c=f(),e&&c>=0&&p(o[c]),u()},h=e=>{o.length!==0&&(c=(c+e+o.length)%o.length,p(o[c]),u())};return{setScene(e){n=e!==null,t=e?Dm(e):null,r=t?.hasText===!0,m(!1)},refreshVisibility(){m(!1)},setQuery(e){e!==i&&(i=e,m(!0))},setCaseSensitive(e){e!==a&&(a=e,m(!0))},next(){h(1)},prev(){h(-1)},clear(){i=``,o=[],s=!1,c=-1,u()},getState:l,getCurrentMatch(){return c>=0?o[c]:null}}}function km(e){let t=``;for(let n=0;n<e.length;n+=1){let r=e[n],i=r.toLowerCase();t+=i.length===1?i:r}return t}function Am(e,t){let n=!1,r=null,i=null,a=null,o=new Map,s=null,c=null,l=null,u=null,d=null,f=0,p=null,m=``,h=!1,g=0,_=new Map;function v(e){s!==e&&(s=e,t.onPreparationProgress?.(e))}function y(t){e.setHover(t),r?.classList.toggle(`drawing-selection-hover`,t!==null)}function b(){let e=a&&i?qr(i,a):null,n=a?o.get(V(a))?.color??e?.color:null;t.onSelectionChange?.(e,n?[...n]:null)}function x(){let t=e.getCanvas(),n=t.getBoundingClientRect();return`${e.getViewKey()}:${t.width}:${t.height}:${n.left}:${n.top}:${n.width}:${n.height}`}function S(){return u?.select?u:c&&!c.signal.aborted&&l?.select?l:null}function C(){f++,u=null,c?.abort(),d!==null&&cancelAnimationFrame(d),d=null}function w(){C(),r?.classList.remove(`drawing-selection-hover`),_.clear(),h=!1,p=null,v(null),a=null,o.clear(),i=e.getScene();let s=i,c=++g;e.sceneChanged(t=>{n&&c===g&&i===s&&e.getScene()===s&&v(t)}),t.onSelectionChange?.(null),m=x()}function T(e,t){if(n&&i&&(t||!u?.select)){if(!t&&c&&!c.signal.aborted&&l?.select){u={point:e,select:!1};return}f++,c?.abort(),u={point:e,select:t},d===null&&!c&&(d=requestAnimationFrame(()=>{d=null,E()}))}}async function E(){if(!n||!i||!u||c)return;let r=u;u=null;let o=f,s=i,m=e.getTarget(),h=x(),g=new AbortController;c=g,l=r;try{let t=await e.pick(r.point,g.signal);if(g.signal.aborted||o!==f||!n||s!==e.getScene()||m!==e.getTarget())return;if(h!==x()){T(r.point,r.select);return}let i=p?.x===r.point.x&&p?.y===r.point.y;y(i?t?.primitive??null:null),r.select&&(a=t?{...t.primitive}:null,e.setSelection(a?[a]:[]),b(),p&&!i&&!u&&(u={point:p,select:!1}))}catch(e){!g.signal.aborted&&!(e instanceof DOMException&&e.name===`AbortError`)&&t.onError?.(e)}finally{c===g&&(c=null,l=null),n&&u&&d===null&&(d=requestAnimationFrame(()=>{d=null,E()}))}}let D=e=>{if(e.button===0||e.pointerType===`touch`){if(C(),_.set(e.pointerId,{x:e.clientX,y:e.clientY,moved:!1}),_.size>1)for(let e of _.values())e.moved=!0;h=!0,y(null)}},O=e=>{p={x:e.clientX,y:e.clientY};let t=_.get(e.pointerId);t&&Math.hypot(e.clientX-t.x,e.clientY-t.y)>4&&(t.moved=!0),!_.size&&e.buttons===0&&e.pointerType!==`touch`&&T(p,!1)},k=e=>{let t=_.get(e.pointerId);_.delete(e.pointerId),h=_.size>0,p=e.pointerType===`touch`?null:{x:e.clientX,y:e.clientY},t&&!t.moved&&!_.size&&Math.hypot(e.clientX-t.x,e.clientY-t.y)<=4&&T({x:e.clientX,y:e.clientY},!0)},A=()=>{_.clear(),h=!1,C(),M()},j=e=>{_.has(e.pointerId)&&A()},M=()=>{p=null,S()?u&&!u.select&&(u=null):C(),y(null)},N=n=>{n.key===`Escape`&&(C(),y(null),a=null,e.setSelection([]),t.onSelectionChange?.(null))};function P(){r&&(r.classList.remove(`drawing-selection-hover`),r.removeEventListener(`pointerdown`,D),r.removeEventListener(`pointermove`,O),r.removeEventListener(`pointerup`,k),r.removeEventListener(`pointercancel`,A),r.removeEventListener(`lostpointercapture`,j),r.removeEventListener(`pointerleave`,M),r.ownerDocument.removeEventListener(`keydown`,N),r=null,_.clear(),h=!1)}function F(){let t=e.getCanvas();r!==t&&(P(),r=t,r.classList.remove(`drawing-selection-hover`),r.addEventListener(`pointerdown`,D),r.addEventListener(`pointermove`,O),r.addEventListener(`pointerup`,k),r.addEventListener(`pointercancel`,A),r.addEventListener(`lostpointercapture`,j),r.addEventListener(`pointerleave`,M),r.ownerDocument.addEventListener(`keydown`,N))}function I(){n=!1,C(),P(),e.dispose(),v(null),a=null,o.clear(),g++,p=null,i=null,t.onSelectionChange?.(null)}return{enable(){n||(n=!0,w(),F())},disable:I,isEnabled:()=>n,setSelectedColor(t){if(a){let n=mi(t);e.setOverrides([a],n),o.set(V(a),{ref:{...a},color:n})}b()},resetSelectedColor(){a&&(e.clearOverrides([a]),o.delete(V(a))),b()},resetAllColors(){e.clearOverrides(),o.clear(),b()},sceneChanged(){n&&w()},rendererChanged(){if(n){if(i!==e.getScene()){w(),F();return}C(),p=null,_.clear(),h=!1,F(),e.rendererChanged(),y(null);for(let{ref:t,color:n}of o.values())e.setOverrides([t],n);e.setSelection(a?[a]:[]),m=x()}},onFrame(){if(!n)return;i!==e.getScene()&&w(),r!==e.getCanvas()&&F();let t=x();if(t!==m){m=t;let n=S();C(),y(null),a&&e.isVisible?.(a)===!1&&(a=null,e.setSelection([]),b()),n&&!h?T(n.point,!0):p&&!h&&T(p,!1)}},dispose:I}}function jm(e){let t=null,n=null,r=null,i=null,a=()=>{},o=!1,s=()=>{i?.dispose(),i=null,o=t!==e.getScene(),r?.dispose(),r=null,o=!1};return Am({isVisible(n){return!!t&&Er(t,n,t=>t===void 0||e.getRenderer().getOptionalContentVisibility?.()?.conditions[t]!==0)},getCanvas:e.getCanvas,getScene:e.getScene,getTarget:e.getRenderer,getViewKey:()=>{let t=e.getRenderer().getViewState();return`${t.cameraCenterX}:${t.cameraCenterY}:${t.zoom}:${e.getRenderer().getOptionalContentVisibility?.()?.revision??0}`},async pick(n,o){if(!t)return null;let s=e.getRenderer(),c=s.clientToScenePoint?.(n.x,n.y)??null,l=e.getCanvas().getBoundingClientRect();if(!c||n.x<l.left||n.x>l.right||n.y<l.top||n.y>l.bottom)return null;i??=new di(t,e=>a(e));let u=s.getOptionalContentVisibility?.(),d=await i.pick({point:c,clientPoint:n,project:e=>s.sceneToClientPoint?.(e.x,e.y)??null,unproject:e=>s.clientToScenePoint?.(e.x,e.y)??null,tolerancePx:4,signal:o,rasterLayers:s.getRasterLayerUpdates?.(),resolveColor(e,t){let n=r?.getOverrideColor(e)??t,i=s.getVectorColorOverride?.();return i?n.map((e,t)=>e*(1-i[3])+i[t]*i[3]):n},...u?{isConditionVisible:e=>e===void 0||u.conditions[e]!==0}:{}});if(u!==s.getOptionalContentVisibility?.())throw new DOMException(`Layer visibility changed during picking.`,`AbortError`);return d},setHover:e=>r?.setHover(e),setSelection:e=>r?.setSelection(e),setOverrides:(e,t)=>r?.setOverrides(e,{color:t}),clearOverrides:e=>r?.clearOverrides(e),sceneChanged(i){s(),t=e.getScene(),n=e.getRenderer(),a=i,n.setPrimitiveHighlights?.(null),t&&(r=new hi(t,{onColors:e=>{o||n?.setPrimitiveColorUpdates?.(e)},onHighlights:e=>{o||n?.setPrimitiveHighlights?.(e)}}))},rendererChanged(){n=e.getRenderer(),n.setPrimitiveColorUpdates?.(r?.getColorUpdates()??[]),n.setPrimitiveHighlights?.(r?.getHighlights()??null)},dispose:s},e)}function Mm(e){let{container:t}=e;t.innerHTML=`
    <label class="drawing-selection-toggle" for="drawing-selection-checkbox">
      Drawing Selection
      <input id="drawing-selection-checkbox" type="checkbox" autocomplete="off" aria-controls="drawing-selection-controls" />
    </label>
    <div id="drawing-selection-controls" class="drawing-selection-controls" hidden>
      <div id="drawing-selection-loading" class="drawing-selection-loading" hidden>
        <span id="drawing-selection-loading-label" role="status">Preparing drawing selection… 0%</span>
        <progress id="drawing-selection-progress" max="100" value="0" aria-labelledby="drawing-selection-loading-label"></progress>
      </div>
      <div id="drawing-selection-info" role="status">Hover or click a drawing element.</div>
      <div class="drawing-selection-actions">
        <label for="drawing-selection-color">Selected color</label>
        <input id="drawing-selection-color" type="color" value="#ff0000" disabled />
        <button id="drawing-selection-reset" type="button" disabled>Reset selected</button>
        <button id="drawing-selection-reset-all" type="button">Reset all colors</button>
      </div>
    </div>`;let n=e=>t.querySelector(`#drawing-selection-${e}`),r=n(`checkbox`),i=n(`controls`),a=n(`loading`),o=n(`loading-label`),s=n(`progress`),c=n(`info`),l=n(`color`),u=n(`reset`),d=n(`reset-all`),f=!1;r.checked=!1;let p=e.createController({onPreparationProgress:e=>{if(f)return;let t=e!==null&&e<100;a.hidden=!t,c.hidden=t,s.value=e??0,o.textContent=`Preparing drawing selection… ${e??0}%`,i.setAttribute(`aria-busy`,String(t))},onSelectionChange:(t,n)=>{if(f)return;let r=t!==null&&t.kind!==`raster`;if(l.disabled=u.disabled=!r,!t){c.textContent=`Hover or click a drawing element.`;return}let i=t.pageIndex===null?``:` · Page ${t.pageIndex+1}`,a=t.bounds;c.textContent=`${t.kind} ${t.index}${i} · ${t.segmentCount} segments · (${a.minX.toFixed(2)}, ${a.minY.toFixed(2)})–(${a.maxX.toFixed(2)}, ${a.maxY.toFixed(2)})`;let o=t.optionalContent?.layerIds;o?.length&&(c.textContent+=` · Layers: ${o.map(t=>{let n=e.getLayerName?.(t);return n?`${n} (${t})`:t}).join(`, `)}`);let s=n??t.color??[1,0,0];l.value=`#`+s.map(e=>Math.round(Math.max(0,Math.min(1,e))*255).toString(16).padStart(2,`0`)).join(``)}});function m(t){f||(r.checked=t,i.hidden=!t,t!==p.isEnabled()&&(t?(e.onEnabledChange?.(!0),p.enable()):(p.disable(),e.onEnabledChange?.(!1))))}let h=()=>m(r.checked),g=()=>p.setSelectedColor(l.value),_=()=>p.resetSelectedColor(),v=()=>p.resetAllColors();return r.addEventListener(`change`,h),l.addEventListener(`input`,g),u.addEventListener(`click`,_),d.addEventListener(`click`,v),{...p,enable:()=>m(!0),disable:()=>m(!1),dispose(){f||(m(!1),p.dispose(),f=!0,r.removeEventListener(`change`,h),l.removeEventListener(`input`,g),u.removeEventListener(`click`,_),d.removeEventListener(`click`,v),t.replaceChildren())}}}function Nm(e,{intervalMs:t=100,signal:n}={}){let r=null,i=null,a=-1/0,o=e.textContent,s=!1;function c(){i!==null&&clearTimeout(i),i=null}function l(){c(),a=performance.now();let t=Fm(r)?r.toLocaleString():`-`;t!==o&&(e.textContent=t,o=t)}function u(e){if(s)return;r=e;let n=t-(performance.now()-a);n<=0?l():i===null&&(i=setTimeout(l,n))}function d(){s||(r=null,l(),a=-1/0)}function f(){s=!0,c(),n?.removeEventListener(`abort`,f)}return n?.aborted?f():n?.addEventListener(`abort`,f,{once:!0}),{update:u,reset:d,dispose:f}}function Pm(){let e=!1,t=0;return{recordNativeFrame(n){e&&t!==null&&(t=Fm(n)?t+n:null)},measure(n,r){let i=n.autoReset;n.autoReset=!1,n.reset(),t=0,e=!0;try{r();let e=n.render.drawCalls??n.render.calls;return t!==null&&Fm(e)?e+t:null}finally{e=!1,n.autoReset=i}}}}function Fm(e){return typeof e==`number`&&Number.isSafeInteger(e)&&e>=0}export{Cf as $,rs as $n,Er as $r,gu as $t,Qf as A,Pt as Ai,Js as An,pa as Ar,Td as At,Hf as B,Ze as Bi,Uo as Bn,Gi as Br,cd as Bt,wp as C,pn as Ci,uu as Cn,Da as Cr,Nd as Ct,rp as D,Ut as Di,Ys as Dn,_a as Dr,Dd as Dt,dp as E,ln as Ei,nc as En,ba as Er,Ed as Et,Jf as F,ht as Fi,vs as Fn,oa as Fr,hd as Ft,Nf as G,ze as Gi,Zo as Gn,zi as Gr,Au as Gt,Vf as H,qe as Hi,cs as Hn,ji as Hr,W as Ht,ep as I,mt as Ii,Ho as In,$i as Ir,gd as It,Af as J,N as Ji,ns as Jn,hi as Jr,Tu as Jt,If as K,z as Ki,Yo as Kn,pi as Kr,wu as Kt,Kf as L,ut as Li,qo as Ln,Ji as Lr,yd as Lt,Xf as M,bt as Mi,Ls as Mn,ia as Mr,Sd as Mt,$f as N,ct as Ni,ps as Nn,la as Nr,Cd as Nt,tp as O,Ht as Oi,Zs as On,ua as Or,Od as Ot,Zf as P,dt as Pi,ys as Pn,ea as Pr,xd as Pt,Df as Q,p as Qi,us as Qn,qr as Qr,hu as Qt,Wf as R,gt as Ri,Go as Rn,Xi as Rr,pd as Rt,Tp as S,dn as Si,fl as Sn,Ea as Sr,Id as St,mp as T,mn as Ti,rc as Tn,ya as Tr,Md as Tt,Uf as U,Je as Ui,ts as Un,Ai as Ur,Nu as Ut,Bf as V,Ke as Vi,Ko as Vn,Ui as Vr,id as Vt,Rf as W,Xe as Wi,Qo as Wn,Ri as Wr,rd as Wt,kf as X,m as Xi,$o as Xn,di as Xr,xu as Xt,Mf as Y,fe as Yi,ls as Yn,V as Yr,Du as Yt,Of as Z,f as Zi,es as Zn,Cr as Zr,U as Zt,Kp as _,Mn as _i,cl as _n,Pa as _r,Ud as _t,Am as a,Kn as ai,ku as an,ro as ar,gf as at,Lp as b,jn as bi,hl as bn,Fa as br,Rd as bt,Om as c,Qn as ci,ju as cn,Co as cr,Xd as ct,vm as d,Fn as di,oc as dn,qa as dr,Bd as dt,mr as ei,bu as en,ss as er,yf as et,em as f,In as fi,Qc as fn,Ma as fr,zd as ft,qp as g,An as gi,su as gn,Ia as gr,Kd as gt,Qp as h,Wn as hi,cu as hn,Aa as hr,qd as ht,jm as i,ir as ii,Su as in,yo as ir,ff as it,Yf as j,kt as ji,qs as jn,Qi as jr,bd as jt,np as k,Bt as ki,Ks as kn,ma as kr,wd as kt,wm as l,Yn as li,yu as ln,Ka as lr,Wd as lt,am as m,Ln as mi,$l as mn,Na as mr,Jd as mt,Pm as n,or as ni,Ou as nn,is as nr,_f as nt,Dm as o,Xn as oi,Cu as on,io as or,uf as ot,$p as p,Un as pi,gl as pn,ja as pr,Yd as pt,jf as q,I as qi,Jo as qn,fi as qr,Eu as qt,Mm as r,rr as ri,mu as rn,Qa as rr,cf as rt,Tm as s,Zn as si,Mu as sn,wo as sr,tf as st,Nm as t,ar as ti,_u as tn,os as tr,vf as tt,Cm as u,Rn as ui,vu as un,Ja as ur,Vd as ut,Wp as v,Pn as vi,pu as vn,La as vr,Hd as vt,_p as w,On as wi,dl as wn,Oa as wr,jd as wt,kp as x,un as xi,$c as xn,Ta as xr,Fd as xt,Ap as y,Nn as yi,ll as yn,ka as yr,Gd as yt,Gf as z,st as zi,Wo as zn,Bi as zr,ld as zt};
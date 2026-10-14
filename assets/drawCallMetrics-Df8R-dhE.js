const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./workerClient-COglgcVC.js","./preload-helper-uBIymjUX.js","./annotationData-DX6uTWLN.js","./nativeTypes-BQHnFu7D.js","./monochromeRaster-BN5vDsqU.js","./pdfRasterCompression-CdTxQZEN.js","./rasterTiles-GlD7ia5J.js","./nodePdfSource-2kKniSRe.js","./standardFontResolver-d7UgpWo-.js","./nativeStandard14Metrics-BLZnCyrL.js","./hepContainerWriter-BujvV9Rr.js","./hepContainerOwnedSections-WK4ws8oH.js","./nativeJbig2Codec-e77gM8G8.js","./nativeFontPostScriptCodecs-B8NSXbvy.js","./nativeCcitt-gnsHVy0u.js","./nativeJpxCodec-BBLArgL8.js","./retainedPageCompositor-b7lXlUBy.js","./heprDocumentData-BnKXbCiZ.js"])))=>i.map(i=>d[i]);
import{t as e}from"./preload-helper-uBIymjUX.js";import{c as t,i as n,l as r,o as i,r as a,s as o}from"./annotationData-DX6uTWLN.js";import{n as s}from"./optionalContentData-CFyj-zla.js";import{a as c,c as l,d as u,i as d,l as f,n as p,p as m,r as h,t as g,u as _}from"./scenePaintQuery-CLBaPf97.js";import{t as v}from"./retainedRasterBounds-CTuCWKTg.js";import{a as y,c as b,d as x,i as S,l as C,n as w,p as T,r as E,s as D,u as O}from"./structureData-CsRdvAzL.js";import{a as k,i as A,n as j,o as M,r as N,s as P}from"./rasterRepeat-2nX8zjEJ.js";import{c as ee,n as F,o as te,p as ne,r as re,s as ie,t as ae}from"./scenePaintGraph-Bq99RSsx.js";import{i as I,n as oe}from"./nativeTypes-BQHnFu7D.js";import{c as se,f as ce,g as le,h as ue,i as de,l as fe,n as pe,o as me,p as he,r as ge,s as _e}from"./monochromeRaster-BN5vDsqU.js";import{_ as ve,a as L,d as ye,f as be,g as xe,h as Se,i as Ce,m as we,n as Te,o as Ee,p as De,r as Oe,s as ke,u as Ae,x as je}from"./heprDocumentData-BnKXbCiZ.js";import{i as Me,n as Ne,r as Pe,t as Fe}from"./rasterTiles-GlD7ia5J.js";var Ie=Object.defineProperty,Le=(e,t)=>{let n={};for(var r in e)Ie(n,r,{get:e[r],enumerable:!0});return t||Ie(n,Symbol.toStringTag,{value:`Module`}),n};(function(){let e=document.createElement(`link`).relList;if(e&&e.supports&&e.supports(`modulepreload`))return;for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);new MutationObserver(e=>{for(let t of e)if(t.type===`childList`)for(let e of t.addedNodes)e.tagName===`LINK`&&e.rel===`modulepreload`&&n(e)}).observe(document,{childList:!0,subtree:!0});function t(e){let t={};return e.integrity&&(t.integrity=e.integrity),e.referrerPolicy&&(t.referrerPolicy=e.referrerPolicy),t.credentials=e.crossOrigin===`use-credentials`?`include`:e.crossOrigin===`anonymous`?`omit`:`same-origin`,t}function n(e){if(e.ep)return;e.ep=!0;let n=t(e);fetch(e.href,n)}})();function Re(e){return{...e,withVectorLod:e.withVectorLod??!0,withTextLod:e.withTextLod??!0}}var ze=1e-8;function Be(e,t,n,r){if(!Number.isFinite(e)||!Number.isFinite(t)||!Number.isFinite(n)||!Number.isFinite(r))return 1/0;let i=e*e+t*t+n*n+r*r,a=e*r-t*n,o=Math.max(0,i*i-4*a*a);return Math.sqrt(Math.max(0,(i+Math.sqrt(o))*.5))}function Ve(e,t,n,r,i){let a=Math.max(1,Math.abs(r)),o=Math.max(1,Math.abs(i)),s=Number.isFinite(n)?n:0,c=2*s/a,l=2*s/o;return new Float64Array([c,0,0,0,0,l,0,0,0,0,1,0,-e*c,-t*l,0,1])}function He(){return{visible:!0,stable:!1,maxPixelsPerLocalUnit:1/0,minPixelsPerLocalUnit:0,minX:-1/0,minY:-1/0,maxX:1/0,maxY:1/0}}function Ue(e,t,n,r,i,a){let o=Math.max(1,n.width),s=Math.max(1,n.height);if(!Je(e)||t.length<16||!Number.isFinite(o)||!Number.isFinite(s))return Ye(r);let c=t[0],l=t[1],u=t[3],d=t[4],f=t[5],p=t[7],m=t[12],h=t[13],g=t[15];if(!Number.isFinite(c)||!Number.isFinite(l)||!Number.isFinite(u)||!Number.isFinite(d)||!Number.isFinite(f)||!Number.isFinite(p)||!Number.isFinite(m)||!Number.isFinite(h)||!Number.isFinite(g))return Ye(r);let _=1/0,v=-1/0,y=1/0,b=1/0,x=1/0,S=-1/0,C=-1/0,w=!0,T=!0,E=!0,D=!0;for(let t=0;t<4;t+=1){let n=t&1?e.maxX:e.minX,i=t&2?e.maxY:e.minY,a=c*n+d*i+m,O=l*n+f*i+h,k=u*n+p*i+g;if(!Number.isFinite(a)||!Number.isFinite(O)||!Number.isFinite(k))return Ye(r);if(_=Math.min(_,k),v=Math.max(v,k),y=Math.min(y,Math.abs(k)),w&&=a<-k,T&&=a>k,E&&=O<-k,D&&=O>k,Math.abs(k)>ze){let e=(a/k*.5+.5)*o,t=(O/k*.5+.5)*s;if(!Number.isFinite(e)||!Number.isFinite(t))return Ye(r);b=Math.min(b,e),x=Math.min(x,t),S=Math.max(S,e),C=Math.max(C,t)}}if(v<-1e-8)return Xe(r);if(_<=ze||y<=ze)return Ye(r);let O=!(w||T||E||D),k=We(t),A,j;if(k){if(A=i?Math.hypot((c*i[0]+d*i[1])*o*.5/g,(l*i[0]+f*i[1])*s*.5/g):Ge(t,o,s),i&&a){let e=(c*a[0]+d*a[1])*o*.5/g,t=(l*a[0]+f*a[1])*s*.5/g,n=(c*i[0]+d*i[1])*o*.5/g,r=(l*i[0]+f*i[1])*s*.5/g,u=Math.hypot(e,t);u>0&&(A=Math.abs(e*r-t*n)/u)}j=A}else{let t=o*.5,n=s*.5,r=0,b=1/0,x=-1/0,S=1/0,C=-1/0,w=0,T=0,E=1/0,D=-1/0,O=1/0,k=-1/0,M=1/0,N=-1/0,P=1/0,ee=-1/0;for(let o=0;o<4;o+=1){let s=o&1?e.maxX:e.minX,_=o&2?e.maxY:e.minY,v=c*s+d*_+m,y=l*s+f*_+h,A=u*s+p*_+g,j=(c*A-v*u)*t,F=(l*A-y*u)*n,te=(d*A-v*p)*t,ne=(f*A-y*p)*n;if(i&&a){let e=j*a[0]+te*a[1],t=F*a[0]+ne*a[1];b=Math.min(b,e),x=Math.max(x,e),S=Math.min(S,t),C=Math.max(C,t),w=Math.max(w,Math.hypot(e,t))}i?(j=j*i[0]+te*i[1],F=F*i[0]+ne*i[1],te=ne=0,r=Math.max(r,Math.hypot(j,F))):r=Math.max(r,Be(j,F,te,ne)),T=Math.max(T,A*A),E=Math.min(E,j),D=Math.max(D,j),O=Math.min(O,F),k=Math.max(k,F),M=Math.min(M,te),N=Math.max(N,te),P=Math.min(P,ne),ee=Math.max(ee,ne)}A=r/(y*y);let F=Math.max(qe(E,D),qe(O,k),qe(M,N),qe(P,ee));if(j=T>0?F/T:0,i&&a){let e=c*(f*g-h*p)-d*(l*g-h*u)+m*(l*p-f*u),r=Math.abs(e*(a[0]*i[1]-a[1]*i[0]))*t*n,o=Math.hypot(qe(b,x),qe(S,C));o>0&&(A=Math.min(A,r/(_*o))),j=w>0?r/(v*w):0}}return Number.isFinite(A)?(r.visible=O,r.stable=!0,r.maxPixelsPerLocalUnit=A,r.minPixelsPerLocalUnit=Number.isFinite(j)?Math.min(j,A):0,r.minX=b,r.minY=x,r.maxX=S,r.maxY=C,r):Ye(r)}function We(e){return e.length>=16&&Math.abs(e[3])<=2**-52&&Math.abs(e[7])<=2**-52}function Ge(e,t,n){let r=1/e[15];return Be(e[0]*r*t*.5,e[1]*r*n*.5,e[4]*r*t*.5,e[5]*r*n*.5)}function Ke(e,t){if(!We(e))return null;let n=e[0],r=e[1],i=e[4],a=e[5],o=e[12],s=e[13],c=e[15],l=n*a-i*r;if(![n,r,i,a,o,s,c,l].every(Number.isFinite)||c<=ze||Math.abs(l)<=2**-52*Math.max(n*n+r*r,i*i+a*a))return null;let u=1/0,d=1/0,f=-1/0,p=-1/0;for(let e=0;e<4;e+=1){let t=(e&1?c:-c)-o,m=(e&2?c:-c)-s,h=(a*t-i*m)/l,g=(n*m-r*t)/l;u=Math.min(u,h),d=Math.min(d,g),f=Math.max(f,h),p=Math.max(p,g)}return[u,d,f,p].every(Number.isFinite)?(t.minX=u,t.minY=d,t.maxX=f,t.maxY=p,t):null}function qe(e,t){return e>0?e:t<0?-t:0}function Je(e){return Number.isFinite(e.minX)&&Number.isFinite(e.minY)&&Number.isFinite(e.maxX)&&Number.isFinite(e.maxY)&&e.maxX>=e.minX&&e.maxY>=e.minY}function Ye(e){return e.visible=!0,e.stable=!1,e.maxPixelsPerLocalUnit=1/0,e.minPixelsPerLocalUnit=0,e.minX=-1/0,e.minY=-1/0,e.maxX=1/0,e.maxY=1/0,e}function Xe(e){return e.visible=!1,e.stable=!0,e.maxPixelsPerLocalUnit=0,e.minPixelsPerLocalUnit=0,e.minX=0,e.minY=0,e.maxX=0,e.maxY=0,e}var Ze=5e4,Qe=1.5,$e=.05,et=.5,tt=1e-6,nt=1/512,rt=1e-9,it=1e-12,at=.001,ot=8192,st=class extends Error{constructor(){super(`Text LOD build cancelled.`),this.name=`TextLodBuildCancelledError`}};function ct(e){return Math.max(0,e.textInstanceCount|0)>=Ze}function lt(e){let t=Kt();try{let n=ht(e);if(typeof n==`string`)return jt(null,n,Kt()-t);for(let e=0;e<n.pageCount;e+=1)gt(n,e);return _t(n,t)}catch(e){return Mt(e,t)}}async function ut(e,t={}){let n=Kt();try{let r=new At(t);r.checkCancelled(),r.report(0,`Preparing Text LOD`);let i=ht(e);if(typeof i==`string`)return r.report(1,`Text LOD unavailable`),jt(null,i,Kt()-n);let a=0;for(let e=0;e<i.pageCount;e+=1){let t=e*2,n=i.scene.pageTextRanges[t],o=n+i.scene.pageTextRanges[t+1];n===o&&gt(i,e,n,o,!0,!0);for(let t=n;t<o;t+=ot){let s=Math.min(o,t+ot);gt(i,e,t,s,t===n,s===o),a+=s-t,await r.maybeYield(!1,a/Math.max(1,i.instanceCount)*.9,`Building Text LOD pages ${e+1}/${i.pageCount}`)}}await r.maybeYield(!0,.92,`Clustering Text LOD`);let o=await vt(i,n,r);return r.report(1,o.data?`Text LOD ready`:`Text LOD unavailable`),o}catch(e){return Mt(e,n)}}function dt(e,t){Ht(e,t);let n=t.exactInstanceCount,r=t.combinedInstanceCount,i=Math.max(0,e.textGlyphCount|0)+1,a=Math.max(0,e.textGlyphSegmentCount|0)+4,o=pt(e,i,a),s={textInstanceA:new Float32Array(r*4),textInstanceB:new Float32Array(r*4),textInstanceC:new Float32Array(r*4),...o};return mt(e,t,s),{scene:{...e,textInstanceCount:r,textInstanceA:s.textInstanceA,textInstanceB:s.textInstanceB,textInstanceC:s.textInstanceC,textGlyphCount:i,textGlyphSegmentCount:a,textGlyphMetaA:s.textGlyphMetaA,textGlyphMetaB:s.textGlyphMetaB,textGlyphSegmentsA:s.textGlyphSegmentsA,textGlyphSegmentsB:s.textGlyphSegmentsB},exactInstanceCount:n,coarseInstanceCount:t.coarseInstanceCount,combinedInstanceCount:r,solidGlyphIndex:t.solidGlyphIndex}}var ft=new WeakMap;function pt(e,t,n){let r=ft.get(e.textGlyphSegmentsA)??[],i=t=>t.textGlyphMetaA===e.textGlyphMetaA&&t.textGlyphMetaB===e.textGlyphMetaB&&t.textGlyphSegmentsB===e.textGlyphSegmentsB&&t.textGlyphCount===e.textGlyphCount&&t.textGlyphSegmentCount===e.textGlyphSegmentCount,a=r.find(e=>i(e.source));if(a)return a.store;let o={textGlyphMetaA:new Float32Array(t*4),textGlyphMetaB:new Float32Array(t*4),textGlyphSegmentsA:new Float32Array(n*4),textGlyphSegmentsB:new Float32Array(n*4)};return r.push({source:e,store:o}),ft.set(e.textGlyphSegmentsA,r),o}function mt(e,t,n){Ht(e,t),Ut(n.textInstanceA,t.combinedInstanceCount,`textInstanceA`),Ut(n.textInstanceB,t.combinedInstanceCount,`textInstanceB`),Ut(n.textInstanceC,t.combinedInstanceCount,`textInstanceC`),Ut(n.textGlyphMetaA,t.solidGlyphIndex+1,`textGlyphMetaA`),Ut(n.textGlyphMetaB,t.solidGlyphIndex+1,`textGlyphMetaB`),Ut(n.textGlyphSegmentsA,Math.max(0,e.textGlyphSegmentCount|0)+4,`textGlyphSegmentsA`),Ut(n.textGlyphSegmentsB,Math.max(0,e.textGlyphSegmentCount|0)+4,`textGlyphSegmentsB`);let r=t.exactInstanceCount*4;n.textInstanceA.set(e.textInstanceA.subarray(0,r),0),n.textInstanceB.set(e.textInstanceB.subarray(0,r),0),n.textInstanceC.set(e.textInstanceC.subarray(0,r),0),n.textInstanceA.set(t.coarseInstanceA,r),n.textInstanceB.set(t.coarseInstanceB,r),n.textInstanceC.set(t.coarseInstanceC,r);for(let e=0;e<t.coarseInstanceCount;e+=1)n.textInstanceB[r+e*4+2]=t.solidGlyphIndex;let i=Math.max(0,e.textGlyphCount|0)*4,a=Math.max(0,e.textGlyphSegmentCount|0)*4;n.textGlyphMetaA.set(e.textGlyphMetaA.subarray(0,i),0),n.textGlyphMetaB.set(e.textGlyphMetaB.subarray(0,i),0),n.textGlyphSegmentsA.set(e.textGlyphSegmentsA.subarray(0,a),0),n.textGlyphSegmentsB.set(e.textGlyphSegmentsB.subarray(0,a),0),n.textGlyphMetaA.set(new Float32Array([Math.max(0,e.textGlyphSegmentCount|0),4,0,0]),i),n.textGlyphMetaB.set(qt,i),n.textGlyphSegmentsA.set(Jt,a),n.textGlyphSegmentsB.set(Yt,a)}function ht(e){let t=Math.max(0,e.textInstanceCount|0),n=Math.max(0,e.pageCount|0);return t<=0||n<=0?`empty-text`:t<5e4?`below-instance-threshold`:R(e,t,n)?e.textInstanceA.length<t*4||e.textInstanceB.length<t*4||e.textInstanceC.length<t*4?`invalid-build-data`:{scene:e,instanceCount:t,pageCount:n,inkAreas:Dt(e),runs:[],coarse:new kt(Math.min(t,65536)),pageRunStarts:new Uint32Array(n),pageRunCounts:new Uint32Array(n),textPaints:(e.drawRuns??[]).filter(e=>e.kind===`text`).sort((e,t)=>e.first-t.first)}:`invalid-page-ranges`}function gt(e,t,n,r,i=!0,a=!0){let{scene:o,instanceCount:s}=e,c=t*2,l=Math.min(s,o.pageTextRanges[c]),u=Math.min(s,l+o.pageTextRanges[c+1]),d=Math.max(l,Math.min(u,n??l)),f=Math.max(d,Math.min(u,r??u)),p=Pt(o,t);i&&(e.pageRunStarts[t]=e.runs.length);let m=d;for(;m<f;){let n=0,r=e.textPaints.length;for(;n<r;){let t=n+r>>>1,i=e.textPaints[t];i.first+i.count<=m?n=t+1:r=t}let i=e.textPaints[n],a=Math.min(f,i?i.first+i.count:f),s=i?.blendMode!==void 0,c=s?null:wt(e,m);if(!c){let n=m,r=null;for(;m<a&&m-n<512&&(s||!wt(e,m));)r=Rt(r,Ft(o,m,p)),m+=1;e.runs.push(Nt({exactStart:n,exactCount:m-n,coarseIndex:-1,pageIndex:t,bounds:r??p,transform:[0,0,0,0,0,0],maxInkHeight:1/0,eligible:!1}));continue}let l=m,u=c.a,d=c.b,h=c.c,g=c.d,_=c.originX,v=c.originY,y=1/c.determinant,b=c.minU,x=c.minV,S=c.maxU,C=c.maxV,w=c.inkArea,T=c.inkHeight,E=Math.max(c.maxU-c.minU,rt),D=(c.minU+c.maxU)*.5,O=0;for(m+=1;m<a&&m-l<512;){let t=wt(e,m);if(!t||!Tt(c,t))break;let n=t.originX-_,r=t.originY-v,i=(g*n-h*r)*y,a=(u*r-d*n)*y,o=Math.max(C-x,rt);if(Math.abs(a)>o*$e)break;let s=t.minU+i,l=t.minV+a,f=t.maxU+i,p=t.maxV+a,k=Math.max(f-s,rt),A=(s+f)*.5,j=A-D,M=Math.min(E,k)*.05,N=j>M?1:j<-M?-1:0,P=O||N,ee=Math.max(E,k)*Qe;if(P>0){if(s-S>ee||j<-E*et)break}else if(P<0){if(b-f>ee||j>E*et)break}else if(Math.max(s-S,b-f,0)>ee)break;O===0&&N!==0&&(O=N),b=Math.min(b,s),x=Math.min(x,l),S=Math.max(S,f),C=Math.max(C,p),E=Math.max(E,k),D=A,w+=t.inkArea,T=Math.max(T,t.inkHeight),m+=1}let k=S-b,A=C-x;if(!(k>rt)||!(A>rt)||!Number.isFinite(w)){e.runs.push(Nt({exactStart:l,exactCount:m-l,coarseIndex:-1,pageIndex:t,bounds:It(o,l,m,p),transform:[0,0,0,0,0,0],maxInkHeight:1/0,eligible:!1}));continue}let j=[u*k,d*k,h*A,g*A,u*b+h*x+_,d*b+g*x+v],M=e.coarse.count,N=Math.min(1,Math.max(0,w/(k*A)));e.coarse.push(j[0],j[1],j[2],j[3],j[4],j[5],0,0,c.red,c.green,c.blue,c.alpha*N),e.runs.push(Nt({exactStart:l,exactCount:m-l,coarseIndex:M,pageIndex:t,bounds:Lt(j),transform:j,maxInkHeight:T,eligible:!0}))}a&&(e.pageRunCounts[t]=e.runs.length-e.pageRunStarts[t])}function _t(e,t){let n=yt(e);if(n)return jt(null,n,Kt()-t);let r=bt(e),i=null;for(;!i;){let e=r.next();e.done&&(i=e.value)}return jt(Ct(e,i,Object.freeze(e.runs.slice()),e.coarse.trimA(),e.coarse.trimB(),e.coarse.trimC()),null,Kt()-t)}async function vt(e,t,n){let r=yt(e);if(r)return n.checkCancelled(),jt(null,r,Kt()-t);let i=bt(e),a=null;for(;!a;){let e=i.next();if(e.done){a=e.value;break}await n.maybeYield(!1,.92+e.value*.055,`Clustering Text LOD hierarchy`)}await n.maybeYield(!0,.98,`Finalizing Text LOD run index`);let o=Object.freeze(e.runs.slice());await n.maybeYield(!0,.985,`Finalizing Text LOD instance A`);let s=e.coarse.trimA();await n.maybeYield(!0,.99,`Finalizing Text LOD instance B`);let c=e.coarse.trimB();await n.maybeYield(!0,.995,`Finalizing Text LOD instance C`);let l=e.coarse.trimC();n.checkCancelled();let u=Ct(e,a,o,s,c,l);return n.checkCancelled(),jt(u,null,Kt()-t)}function yt(e){let t=e.coarse.count;return t<=0?`no-coarse-runs`:t>e.instanceCount*.7?`insufficient-reduction`:null}function*bt(e){let t=[],n=[],r=Math.max(1,e.runs.length),i=0;for(let a=0;a<e.pageCount;a+=1){let o=e.pageRunStarts[a],s=o+e.pageRunCounts[a],c=t.length,l=o;for(;l<s;){let n=e.runs[l],o=n.eligible,c=l,u=0,d=0,f=null,p=0,m=0,h=xt(n,2),g=xt(n,0);for(;l<s;){let t=e.runs[l];if(t.eligible!==o||u+t.exactCount>512||o&&d+1>12)break;let n=Rt(f,t.bounds),r=p+zt(t.bounds);if(l>c&&zt(n)>Math.max(rt,r)*4)break;f=n,p=r,u+=t.exactCount,d+=+!!t.eligible,m=Math.max(m,t.maxInkHeight),h=St(h,xt(t,2)),g=St(g,xt(t,0)),l+=1}t.push(Object.freeze({pageIndex:a,runStart:c,runCount:l-c,exactStart:n.exactStart,exactCount:u,coarseStart:o?n.coarseIndex:-1,coarseCount:d,bounds:Object.freeze(f??Pt(e.scene,a)),maxInkHeight:m,inkHeightDirection:h,baselineDirection:g,eligible:o})),i+=1,i>=256&&(i=0,yield Math.min(1,l/r))}let u=e.scene.pageTextRanges[a*2],d=e.scene.pageTextRanges[a*2+1],f=0,p=0,m=t[c]?.inkHeightDirection,h=t[c]?.baselineDirection,g=t.length>c,_=Pt(e.scene,a);for(let e=c;e<t.length;e+=1)f+=t[e].coarseCount,p=Math.max(p,t[e].maxInkHeight),m=St(m,t[e].inkHeightDirection),h=St(h,t[e].baselineDirection),g&&=t[e].eligible,_=Rt(_,t[e].bounds);n.push(Object.freeze({pageIndex:a,clusterStart:c,clusterCount:t.length-c,exactStart:u,exactCount:d,coarseCount:f,bounds:Object.freeze(_),maxInkHeight:p,inkHeightDirection:m,baselineDirection:h,eligible:g})),(i>0||(a+1)%32==0)&&(i=0,yield Math.max(Math.min(1,(a+1)/Math.max(1,e.pageCount)),Math.min(1,s/r)))}return{clusters:t,pages:n}}function xt(e,t){if(!e.eligible)return;let n=e.transform[t],r=e.transform[t+1],i=Math.hypot(n,r);if(!(i>0)||!Number.isFinite(i))return;let a=n<0||n===0&&r<0?-1:1;return Object.freeze([a*n/i,a*r/i])}function St(e,t){return e&&t&&e[0]===t[0]&&e[1]===t[1]?e:void 0}function Ct(e,t,n,r,i,a){return Object.freeze({exactInstanceCount:e.instanceCount,coarseInstanceCount:e.coarse.count,combinedInstanceCount:e.instanceCount+e.coarse.count,solidGlyphIndex:Math.max(0,e.scene.textGlyphCount|0),runs:n,clusters:Object.freeze(t.clusters),pages:Object.freeze(t.pages),coarseInstanceA:r,coarseInstanceB:i,coarseInstanceC:a})}function wt(e,t){let{scene:n}=e,r=t*4;if((n.textInstanceB[r+3]??0)>0)return null;let i=n.textInstanceA[r],a=n.textInstanceA[r+1],o=n.textInstanceA[r+2],s=n.textInstanceA[r+3],c=n.textInstanceB[r],l=n.textInstanceB[r+1],u=Math.trunc(n.textInstanceB[r+2]),d=n.textInstanceC[r],f=n.textInstanceC[r+1],p=n.textInstanceC[r+2],m=n.textInstanceC[r+3];if(![i,a,o,s,c,l,d,f,p,m].every(Number.isFinite))return null;let h=i*s-a*o,g=Math.max(0,n.textGlyphCount|0);if(Math.abs(h)<=it||u<0||u>=g)return null;let _=u*4;if(_+3>=n.textGlyphMetaA.length||_+1>=n.textGlyphMetaB.length)return null;let v=n.textGlyphMetaA[_+2],y=n.textGlyphMetaA[_+3],b=n.textGlyphMetaB[_],x=n.textGlyphMetaB[_+1],S=x-y,C=S*Math.hypot(o,s);return![v,y,b,x,C].every(Number.isFinite)||!(b-v>rt)||!(S>rt)||!(C>rt)?null:{a:i,b:a,c:o,d:s,determinant:h,originX:c,originY:l,minU:v,minV:y,maxU:b,maxV:x,inkArea:e.inkAreas[u]??0,inkHeight:C,red:d,green:f,blue:p,alpha:m}}function Tt(e,t){return Math.abs(e.a-t.a)<=tt&&Math.abs(e.b-t.b)<=tt&&Math.abs(e.c-t.c)<=tt&&Math.abs(e.d-t.d)<=tt&&Math.abs(e.red-t.red)<=nt&&Math.abs(e.green-t.green)<=nt&&Math.abs(e.blue-t.blue)<=nt&&Math.abs(e.alpha-t.alpha)<=nt}function R(e,t,n){if(!(e.pageTextRanges instanceof Uint32Array)||e.pageTextRanges.length<n*2)return!1;let r=0;for(let i=0;i<n;i+=1){let n=e.pageTextRanges[i*2],a=e.pageTextRanges[i*2+1];if(n!==r||a>t-r)return!1;r+=a}return r===t}function Et(e,t,n,r,i){let a=Ot(e,t,r,i);for(let r=0;r<e;r+=1){let e=r*4,i=(n[e]-t[e+2])*(n[e+1]-t[e+3]);n[e+2]=i>0&&Number.isFinite(i)?Math.min(1,a[r]/i):0}}function Dt(e){return Ot(Math.max(0,e.textGlyphCount|0),e.textGlyphMetaA,e.textGlyphSegmentsA,e.textGlyphSegmentsB)}function Ot(e,t,n,r){let i=new Float32Array(e);for(let a=0;a<e;a+=1){let e=a*4,o=Math.max(0,Math.trunc(t[e]??0)),s=Math.max(0,Math.trunc(t[e+1]??0)),c=0,l=!1,u=0,d=0,f=0,p=0;for(let e=0;e<s;e+=1){let t=(o+e)*4;if(t+3>=n.length||t+3>=r.length)break;let i=n[t],a=n[t+1],s=n[t+2],m=n[t+3],h=r[t],g=r[t+1],_=r[t+2];[i,a,s,m,h,g,_].every(Number.isFinite)&&((!l||!Gt(i,a,f,p))&&(l&&(c+=f*d-p*u),l=!0,u=i,d=a),c+=_>=.5?2/3*(i*m-a*s)+1/3*(i*g-a*h)+2/3*(s*g-m*h):i*g-a*h,f=h,p=g)}l&&(c+=f*d-p*u),i[a]=Math.abs(c)*.5}return i}var kt=class{capacity;a;b;c;count=0;constructor(e){this.capacity=Math.max(16,e),this.a=new Float32Array(this.capacity*4),this.b=new Float32Array(this.capacity*4),this.c=new Float32Array(this.capacity*4)}push(e,t,n,r,i,a,o,s,c,l,u,d){this.count>=this.capacity&&this.grow();let f=this.count*4;this.a.set([e,t,n,r],f),this.b.set([i,a,o,s],f),this.c.set([c,l,u,d],f),this.count+=1}trimA(){return this.a.slice(0,this.count*4)}trimB(){return this.b.slice(0,this.count*4)}trimC(){return this.c.slice(0,this.count*4)}grow(){this.capacity*=2,this.a=Wt(this.a,this.capacity*4),this.b=Wt(this.b,this.capacity*4),this.c=Wt(this.c,this.capacity*4)}},At=class{options;yieldIntervalMs;lastYieldAt=Kt();lastProgress=-1;constructor(e){this.options=e,this.yieldIntervalMs=Math.max(1,e.yieldIntervalMs??50)}checkCancelled(){if(this.options.signal?.aborted||this.options.shouldCancel?.())throw new st}report(e,t){let n=Math.max(this.lastProgress,Math.min(1,Math.max(0,e)));this.lastProgress=n,this.options.onProgress?.({value:n,message:t})}async maybeYield(e,t,n){this.checkCancelled(),this.report(t,n),!(!e&&Kt()-this.lastYieldAt<this.yieldIntervalMs)&&(await new Promise(e=>globalThis.setTimeout(e,0)),this.lastYieldAt=Kt(),this.checkCancelled())}};function jt(e,t,n){return Object.freeze({data:e,fallbackReason:t,buildTimeMs:Math.max(0,n)})}function Mt(e,t){if(e instanceof RangeError&&/allocation failed|array buffer|invalid (?:typed )?array length|out of memory|length too large|maximum array/i.test(e.message))return jt(null,`resource-capacity`,Kt()-t);throw e}function Nt(e){return Object.freeze({...e,bounds:Object.freeze(Bt(e.bounds)),transform:Object.freeze([...e.transform])})}function Pt(e,t){let n=t*4;if(n+3<e.pageRects.length){let t=e.pageRects[n],r=e.pageRects[n+1],i=e.pageRects[n+2],a=e.pageRects[n+3],o={minX:Math.min(t,i),minY:Math.min(r,a),maxX:Math.max(t,i),maxY:Math.max(r,a)};if(Vt(o))return o}return Vt(e.bounds)?Bt(e.bounds):{minX:0,minY:0,maxX:0,maxY:0}}function Ft(e,t,n){let r=t*4,i=e.textInstanceA[r],a=e.textInstanceA[r+1],o=e.textInstanceA[r+2],s=e.textInstanceA[r+3],c=e.textInstanceB[r],l=e.textInstanceB[r+1],u=Math.trunc(e.textInstanceB[r+2]),d=u*4;if([i,a,o,s,c,l].every(Number.isFinite)&&u>=0&&d+3<e.textGlyphMetaA.length&&d+1<e.textGlyphMetaB.length){let t=e.textGlyphMetaA[d+2],n=e.textGlyphMetaA[d+3],r=e.textGlyphMetaB[d],u=e.textGlyphMetaB[d+1];if([t,n,r,u].every(Number.isFinite))return Lt([i*(r-t),a*(r-t),o*(u-n),s*(u-n),i*t+o*n+c,a*t+s*n+l])}return Bt(n)}function It(e,t,n,r){let i=null;for(let a=t;a<n;a+=1)i=Rt(i,Ft(e,a,r));return i??Bt(r)}function Lt(e){let[t,n,r,i,a,o]=e,s=a,c=o,l=t+a,u=n+o,d=r+a,f=i+o,p=t+r+a,m=n+i+o;return{minX:Math.min(s,l,d,p),minY:Math.min(c,u,f,m),maxX:Math.max(s,l,d,p),maxY:Math.max(c,u,f,m)}}function Rt(e,t){return e?{minX:Math.min(e.minX,t.minX),minY:Math.min(e.minY,t.minY),maxX:Math.max(e.maxX,t.maxX),maxY:Math.max(e.maxY,t.maxY)}:Bt(t)}function zt(e){return Math.max(0,e.maxX-e.minX)*Math.max(0,e.maxY-e.minY)}function Bt(e){return{minX:e.minX,minY:e.minY,maxX:e.maxX,maxY:e.maxY}}function Vt(e){return Number.isFinite(e.minX)&&Number.isFinite(e.minY)&&Number.isFinite(e.maxX)&&Number.isFinite(e.maxY)&&e.maxX>=e.minX&&e.maxY>=e.minY}function Ht(e,t){if(t.exactInstanceCount!==Math.max(0,e.textInstanceCount|0)||t.solidGlyphIndex!==Math.max(0,e.textGlyphCount|0)||t.combinedInstanceCount!==t.exactInstanceCount+t.coarseInstanceCount)throw Error(`Text LOD build data does not belong to this scene.`)}function Ut(e,t,n){if(e.length<t*4)throw RangeError(`${n} requires at least ${t*4} floats.`)}function Wt(e,t){let n=new Float32Array(t);return n.set(e),n}function Gt(e,t,n,r){return Math.abs(e-n)<=at&&Math.abs(t-r)<=at}function Kt(){return typeof performance<`u`&&typeof performance.now==`function`?performance.now():Date.now()}var qt=new Float32Array([1,1,0,0]),Jt=new Float32Array([0,0,0,0,1,0,0,0,1,1,0,0,0,1,0,0]),Yt=new Float32Array([1,0,0,0,1,1,0,0,0,1,0,0,0,0,0,0]),Xt=.5,Zt=.75,Qt=.1,$t=2e5,en=new WeakMap,tn=new WeakMap;function nn(e){return en.get(e)??null}function rn(e){let t=en.get(e);if(t)return t;let n=lt(e);return en.set(e,n),n}function an(e,t={}){let n=en.get(e);if(n)return Promise.resolve(n);let r=tn.get(e);if(r)return r;let i=on(e,t).then(t=>(en.set(e,t),tn.delete(e),t),t=>{throw tn.delete(e),t});return tn.set(e,i),i}async function on(t,n){if(typeof Worker<`u`&&ct(t)){let r;try{r=await e(()=>import(`./lodWorkerClient-BvKlBoBI.js`),[],import.meta.url)}catch(e){console.warn(`[HEPR] LOD worker module unavailable; preparing cooperatively.`,e)}if(!r)return ut(t,n);let i=0,a={...n,onProgress:e=>{i=Math.max(i,e.value),n.onProgress?.({...e,value:i})}};return await r.buildTextLodInWorker(t,a)||ut(t,a)}return ut(t,n)}function sn(e,t){en.set(e,t)}function cn(e,t){if(en.has(t))return!0;if(tn.has(t))return!1;let n=en.get(e)?.data,r=e.pageRects.length/4;if(!n||!Number.isInteger(r)||r<1||n.pages.length!==r||t.pageRects.length!==e.pageRects.length||e.textInstanceCount!==t.textInstanceCount||n.exactInstanceCount!==t.textInstanceCount||e.textGlyphCount!==t.textGlyphCount||e.textGlyphMetaA!==t.textGlyphMetaA||e.textGlyphMetaB!==t.textGlyphMetaB||e.textGlyphSegmentsA!==t.textGlyphSegmentsA||e.textGlyphSegmentsB!==t.textGlyphSegmentsB||e.pageTextRanges.length<r*2||t.pageTextRanges.length<r*2)return!1;let i=new Map(e.pdfPages?.map(e=>[e.pageIndex,e.pdfToScene])),a=new Map(t.pdfPages?.map(e=>[e.pageIndex,e.pdfToScene])),o=[],s=0;for(let n=0;n<r;n++){let r=n*2,c=n*4,l=e.pageTextRanges[r+1];if(e.pageTextRanges[r]!==s||t.pageTextRanges[r]!==s||t.pageTextRanges[r+1]!==l||l>t.textInstanceCount-s)return!1;s+=l;let u=e.pageRects.subarray(c,c+4),d=t.pageRects.subarray(c,c+4);if(![...u,...d].every(Number.isFinite))return!1;let f=Math.max(1,Math.abs(u[0]),Math.abs(u[2]),Math.abs(d[0]),Math.abs(d[2]))*2**-22,p=Math.max(1,Math.abs(u[1]),Math.abs(u[3]),Math.abs(d[1]),Math.abs(d[3]))*2**-22,m=d[0]-u[0],h=d[1]-u[1],g=i.get(n),_=a.get(n);if(g&&_){if(g.slice(0,4).some((e,t)=>e!==_[t]))return!1;m=_[4]-g[4],h=_[5]-g[5]}if(!Number.isFinite(m)||!Number.isFinite(h)||Math.abs(d[0]-u[0]-m)>f||Math.abs(d[2]-u[2]-m)>f||Math.abs(d[1]-u[1]-h)>p||Math.abs(d[3]-u[3]-h)>p)return!1;o.push({dx:m,dy:h,paddingX:f,paddingY:p})}if(s!==t.textInstanceCount)return!1;let c=e=>{let{dx:t,dy:n,paddingX:r,paddingY:i}=o[e.pageIndex],a=e.bounds,s=Math.max(r,Math.abs(a.minX+t)*2**-22,Math.abs(a.maxX+t)*2**-22),c=Math.max(i,Math.abs(a.minY+n)*2**-22,Math.abs(a.maxY+n)*2**-22);return Object.freeze({...e,bounds:Object.freeze({minX:a.minX+t-s,minY:a.minY+n-c,maxX:a.maxX+t+s,maxY:a.maxY+n+c})})},l=n.coarseInstanceB.slice(),u=n.runs.map(e=>{let{dx:t,dy:n}=o[e.pageIndex],[r,i,a,s,u,d]=e.transform,f=[r,i,a,s,u+t,d+n];if(e.coarseIndex>=0){let r=e.coarseIndex*4;l[r]+=t,l[r+1]+=n}return Object.freeze({...c(e),transform:Object.freeze(f)})});return sn(t,Object.freeze({data:Object.freeze({...n,runs:Object.freeze(u),clusters:Object.freeze(n.clusters.map(c)),pages:Object.freeze(n.pages.map(c)),coarseInstanceB:l}),fallbackReason:null,buildTimeMs:0})),!0}var ln=class{data;buildTimeMs;buildFallbackReason;resourceFallbackReason=null;mode;clusterStates;clusterVisibility;selectedInstanceIds=new Uint32Array;exactIdentityInstanceIds=null;selectionScratch=new Uint32Array;selectionInitialized=!1;lastUpdateValid=!1;lastPageMatrices;lastPageRevision;lastPageOffsets;lastPageEnabled;lastPageLayoutRevision;lastLocalToClip=new Float64Array(16);lastViewportWidth=0;lastViewportHeight=0;lastHasCullingBounds=!1;lastCullingBounds=new Float64Array(4);selectionUploads=0;stats;pageProjection=He();clusterProjection=He();selectionViewportScratch={width:1,height:1};visibilityBounds={minX:0,minY:0,maxX:0,maxY:0};pageVisibilityBounds={minX:0,minY:0,maxX:0,maxY:0};affineViewBounds={minX:0,minY:0,maxX:0,maxY:0};affineVisibility={minX:0,minY:0,maxX:0,maxY:0};affineScale=0;lastAffineValid=!1;lastAffineScale=0;affineBasis=new Float64Array(4);lastAffineBasis=new Float64Array(4);lastAffineVisibility=new Float64Array(4);constructor(e,t=`auto`){this.data=e.data,this.buildTimeMs=e.buildTimeMs,this.buildFallbackReason=e.fallbackReason,this.mode=t,this.clusterStates=new Uint8Array(e.data?.clusters.length??0),this.clusterVisibility=new Uint8Array(e.data?.clusters.length??0),this.stats=this.createEmptyStats()}setMode(e){if(e!==`auto`&&e!==`off`)throw RangeError(`Unsupported Text LOD mode: ${String(e)}`);e!==this.mode&&(this.mode=e,e===`off`&&this.clusterStates.fill(0),this.selectionInitialized=!1,this.lastUpdateValid=!1,this.lastAffineValid=!1,this.stats=this.createEmptyStats())}getMode(){return this.mode}setResourceFallback(e){let t=e&&e.length>0?e:null;t!==this.resourceFallbackReason&&(this.resourceFallbackReason=t,this.selectionInitialized=!1,this.lastUpdateValid=!1,this.lastAffineValid=!1,this.stats=this.createEmptyStats())}update(e){let t=this.data;if(!t||this.resourceFallbackReason)return this.finishUnavailableSelection();let n=e.pixelRatio??1;if(Number.isFinite(n)&&n>1&&(e={...e,viewportWidth:e.viewportWidth/n,viewportHeight:e.viewportHeight/n}),this.selectionInitialized&&this.isSameSelectionUpdate(e))return{instanceIds:this.selectedInstanceIds,changed:!1,stats:this.getStats()};let r=e.pageOffsets!==void 0&&this.resolveAffineView(e),i=r?e.pageOffsets:void 0,a=r||!e.pageLocalToClip&&this.resolveAffineView(e);if(a&&this.selectionInitialized&&this.isSameAffineSelection()&&this.isSamePageLayout(e))return this.rememberSelectionUpdate(e),{instanceIds:this.selectedInstanceIds,changed:!1,stats:this.getStats()};let o=!this.selectionInitialized,s=!1,c=0,l=0,u=0,d=0,f=0,p=a?this.affineVisibility:this.resolveVisibilityBounds(e.cullingBounds);for(let n of t.pages){let r=p;if(i&&p){if(e.pageEnabled?.[n.pageIndex]===0){hn(n.clusterStart,n.clusterCount,this.clusterVisibility)&&(s=!0);continue}let t=i[n.pageIndex*2],a=i[n.pageIndex*2+1];r=this.pageVisibilityBounds,r.minX=p.minX-t,r.minY=p.minY-a,r.maxX=p.maxX-t,r.maxY=p.maxY-a}let o=e.pageLocalToClip?.[n.pageIndex]??e.localToClip;if(!i&&e.pageVisibility?.[n.pageIndex]===0||r&&!_n(n.bounds,r)){hn(n.clusterStart,n.clusterCount,this.clusterVisibility)&&(s=!0);continue}let m=a?null:Ue(n.bounds,o,this.selectionViewport(e),this.pageProjection,n.inkHeightDirection,n.baselineDirection);if(m&&m.stable&&!m.visible){hn(n.clusterStart,n.clusterCount,this.clusterVisibility)&&(s=!0);continue}let h=!m||m.stable,g=m?m.maxPixelsPerLocalUnit:this.affineInkHeightScale(n.inkHeightDirection,n.baselineDirection),_=n.eligible&&n.clusterCount>0&&vn(this.clusterStates,n.clusterStart,n.clusterCount,1),v=_?Zt:Xt;if(this.mode===`auto`&&n.eligible&&h&&(_?n.maxInkHeight*g<v:n.maxInkHeight*g<=v)){let e=n.clusterStart+n.clusterCount;for(let r=n.clusterStart;r<e;r+=1){let e=t.clusters[r];gn(this.clusterVisibility,r,1)&&(s=!0),gn(this.clusterStates,r,1)&&(s=!0),c+=1,u+=1,f+=e.coarseCount}continue}let y=m!==null&&m.stable&&fn(m,e),b=n.clusterStart+n.clusterCount;for(let i=n.clusterStart;i<b;i+=1){let a=t.clusters[i];if(r&&!_n(a.bounds,r)){gn(this.clusterVisibility,i,0)&&(s=!0);continue}let p=this.clusterStates[i]===1,h=this.mode===`auto`&&a.eligible,g=-1;if(m?y&&(h?dn(a.maxInkHeight*m.maxPixelsPerLocalUnit,p)?g=1:(n.inkHeightDirection||!a.inkHeightDirection)&&(n.baselineDirection||!a.baselineDirection)&&a.maxInkHeight*m.minPixelsPerLocalUnit>=.75&&(g=0):g=0):g=h&&dn(a.maxInkHeight*this.affineInkHeightScale(a.inkHeightDirection,a.baselineDirection),p)?1:0,g<0){let t=Ue(a.bounds,o,this.selectionViewport(e),this.clusterProjection,a.inkHeightDirection,a.baselineDirection);if(t.stable&&!t.visible){gn(this.clusterVisibility,i,0)&&(s=!0);continue}g=h&&t.stable&&dn(a.maxInkHeight*t.maxPixelsPerLocalUnit,p)?1:0}gn(this.clusterVisibility,i,1)&&(s=!0),c+=1;let _=g===1;gn(this.clusterStates,i,+!!_)&&(s=!0),_?(u+=1,f+=a.coarseCount):(l+=1,d+=a.exactCount)}}let m=o||s;return m&&(this.selectedInstanceIds=this.buildSelectedInstanceIds(t,c===t.clusters.length&&u===0&&d===t.exactInstanceCount),this.selectionUploads+=1,this.selectionInitialized=!0),this.stats={mode:this.mode,available:!0,fallbackReason:null,buildTimeMs:this.buildTimeMs,totalRuns:t.runs.length,totalClusters:t.clusters.length,visibleClusters:c,exactClusters:l,coarseClusters:u,renderedGlyphs:d,renderedRuns:f,selectedInstances:this.selectedInstanceIds.length,selectionUploads:this.selectionUploads,exactBudgetOverage:Math.max(0,d-$t)},this.rememberSelectionUpdate(e),this.rememberAffineSelection(a),{instanceIds:this.selectedInstanceIds,changed:m,stats:this.getStats()}}resolveAffineView(e){let t=Math.max(1,e.viewportWidth),n=Math.max(1,e.viewportHeight);if(!Number.isFinite(t)||!Number.isFinite(n))return!1;let r=Ke(e.localToClip,this.affineViewBounds);if(!r)return!1;let i=Ge(e.localToClip,t,n);if(!Number.isFinite(i))return!1;let a=e.pageOffsets?null:e.cullingBounds;a&&(r.minX=Math.max(r.minX,a.minX),r.minY=Math.max(r.minY,a.minY),r.maxX=Math.min(r.maxX,a.maxX),r.maxY=Math.min(r.maxY,a.maxY));let o=this.lastAffineValid&&i===this.lastAffineScale?this.resolveVisibilityBounds(r)??r:r,s=this.affineVisibility;s.minX=o.minX,s.minY=o.minY,s.maxX=o.maxX,s.maxY=o.maxY,this.affineScale=i;let c=e.localToClip,l=c[15];return this.affineBasis[0]=c[0]/l*t*.5,this.affineBasis[1]=c[1]/l*n*.5,this.affineBasis[2]=c[4]/l*t*.5,this.affineBasis[3]=c[5]/l*n*.5,!0}affineInkHeightScale(e,t){if(!e)return this.affineScale;let n=this.affineBasis,r=n[0]*e[0]+n[2]*e[1],i=n[1]*e[0]+n[3]*e[1];if(t){let e=n[0]*t[0]+n[2]*t[1],a=n[1]*t[0]+n[3]*t[1],o=Math.hypot(e,a);if(o>0)return Math.abs(e*i-a*r)/o}return Math.hypot(r,i)}isSamePageLayout(e){return this.lastPageOffsets===e.pageOffsets&&this.lastPageEnabled===e.pageEnabled&&this.lastPageLayoutRevision===e.pageLayoutRevision&&(e.pageOffsets===void 0||e.pageLayoutRevision!==void 0)}isSameAffineSelection(){let e=this.affineVisibility;return this.lastAffineValid&&this.affineScale===this.lastAffineScale&&this.affineBasis[0]===this.lastAffineBasis[0]&&this.affineBasis[1]===this.lastAffineBasis[1]&&this.affineBasis[2]===this.lastAffineBasis[2]&&this.affineBasis[3]===this.lastAffineBasis[3]&&e.minX===this.lastAffineVisibility[0]&&e.minY===this.lastAffineVisibility[1]&&e.maxX===this.lastAffineVisibility[2]&&e.maxY===this.lastAffineVisibility[3]}rememberAffineSelection(e){this.lastAffineValid=e,e&&(this.lastAffineScale=this.affineScale,this.lastAffineBasis.set(this.affineBasis),this.lastAffineVisibility[0]=this.affineVisibility.minX,this.lastAffineVisibility[1]=this.affineVisibility.minY,this.lastAffineVisibility[2]=this.affineVisibility.maxX,this.lastAffineVisibility[3]=this.affineVisibility.maxY)}resolveVisibilityBounds(e){if(!e)return null;let t=un((e.maxX-e.minX)*Qt),n=un((e.maxY-e.minY)*Qt);if(t<=0||n<=0)return e;let r=this.visibilityBounds;return r.minX=Math.floor(e.minX/t)*t,r.minY=Math.floor(e.minY/n)*n,r.maxX=Math.ceil(e.maxX/t)*t,r.maxY=Math.ceil(e.maxY/n)*n,r}selectionViewport(e){return this.selectionViewportScratch.width=e.viewportWidth,this.selectionViewportScratch.height=e.viewportHeight,this.selectionViewportScratch}getSelectedInstanceIds(){return this.selectedInstanceIds}getStats(){return{...this.stats}}dispose(){this.data=null,this.clusterStates=new Uint8Array,this.clusterVisibility=new Uint8Array,this.selectedInstanceIds=new Uint32Array,this.exactIdentityInstanceIds=null,this.selectionScratch=new Uint32Array,this.selectionInitialized=!1,this.lastUpdateValid=!1,this.lastAffineValid=!1,this.stats=this.createEmptyStats()}finishUnavailableSelection(){let e=this.selectedInstanceIds.length!==0;return e&&(this.selectedInstanceIds=new Uint32Array,this.selectionUploads+=1),this.selectionInitialized=!0,this.stats=this.createEmptyStats(),{instanceIds:this.selectedInstanceIds,changed:e,stats:this.getStats()}}createEmptyStats(){return{mode:this.mode,available:this.data!==null&&this.resourceFallbackReason===null,fallbackReason:this.resourceFallbackReason??this.buildFallbackReason,buildTimeMs:this.buildTimeMs,totalRuns:this.data?.runs.length??0,totalClusters:this.data?.clusters.length??0,visibleClusters:0,exactClusters:0,coarseClusters:0,renderedGlyphs:0,renderedRuns:0,selectedInstances:0,selectionUploads:this.selectionUploads,exactBudgetOverage:0}}buildSelectedInstanceIds(e,t){let n=this.ensureIdentityInstanceIds(e);if(t)return n.subarray(0,e.exactInstanceCount);this.selectionScratch.length<e.combinedInstanceCount&&(this.selectionScratch=new Uint32Array(e.combinedInstanceCount));let r=this.selectionScratch,i=0,a=0,o=0;for(let t=0;t<e.clusters.length;t+=1){if(this.clusterVisibility[t]===0)continue;let s=e.clusters[t],c=this.clusterStates[t]===1?e.exactInstanceCount+s.coarseStart:s.exactStart,l=this.clusterStates[t]===1?s.coarseCount:s.exactCount;if(!(l<=0)){if(c===o){o+=l;continue}i=mn(r,i,n,a,o),a=c,o=c+l}}return i=mn(r,i,n,a,o),r.subarray(0,i)}ensureIdentityInstanceIds(e){let t=this.exactIdentityInstanceIds;if(!t||t.length<e.combinedInstanceCount){t=new Uint32Array(e.combinedInstanceCount);for(let e=0;e<t.length;e+=1)t[e]=e;this.exactIdentityInstanceIds=t}return t}isSameSelectionUpdate(e){if(!this.lastUpdateValid||e.localToClip.length<16||this.lastPageMatrices!==e.pageLocalToClip||this.lastPageRevision!==e.pageRevision||e.pageLocalToClip&&e.pageRevision===void 0||!this.isSamePageLayout(e)||Number(e.viewportWidth)!==this.lastViewportWidth||Number(e.viewportHeight)!==this.lastViewportHeight)return!1;if(!e.pageLocalToClip||e.pageOffsets){for(let t=0;t<16;t+=1)if(Number(e.localToClip[t])!==this.lastLocalToClip[t])return!1}let t=e.cullingBounds;return t!=null===this.lastHasCullingBounds?!t||t.minX===this.lastCullingBounds[0]&&t.minY===this.lastCullingBounds[1]&&t.maxX===this.lastCullingBounds[2]&&t.maxY===this.lastCullingBounds[3]:!1}rememberSelectionUpdate(e){if(this.lastPageMatrices=e.pageLocalToClip,this.lastPageRevision=e.pageRevision,this.lastPageOffsets=e.pageOffsets,this.lastPageEnabled=e.pageEnabled,this.lastPageLayoutRevision=e.pageLayoutRevision,e.localToClip.length<16){this.lastUpdateValid=!1;return}for(let t=0;t<16;t+=1)this.lastLocalToClip[t]=Number(e.localToClip[t]);this.lastViewportWidth=Number(e.viewportWidth),this.lastViewportHeight=Number(e.viewportHeight);let t=e.cullingBounds;this.lastHasCullingBounds=t!=null,t&&(this.lastCullingBounds[0]=t.minX,this.lastCullingBounds[1]=t.minY,this.lastCullingBounds[2]=t.maxX,this.lastCullingBounds[3]=t.maxY),this.lastUpdateValid=!0}};function un(e){return!Number.isFinite(e)||e<=0?0:2**Math.round(Math.log2(e))}function dn(e,t){return t?e<Zt:e<=Xt}function fn(e,t){return e.minX>=0&&e.minY>=0&&e.maxX<=Math.max(1,t.viewportWidth)&&e.maxY<=Math.max(1,t.viewportHeight)}var pn=64;function mn(e,t,n,r,i){let a=i-r;if(a<=0)return t;if(a>=pn)e.set(n.subarray(r,i),t);else for(let n=r;n<i;n+=1)e[t+n-r]=n;return t+a}function hn(e,t,n){let r=Math.min(n.length,e+t),i=!1;for(let t=e;t<r;t+=1)n[t]!==0&&(n[t]=0,i=!0);return i}function gn(e,t,n){return e[t]!==n&&(e[t]=n,!0)}function _n(e,t){return e.maxX>=t.minX&&e.minX<=t.maxX&&e.maxY>=t.minY&&e.minY<=t.maxY}function vn(e,t,n,r){let i=Math.min(e.length,t+n);for(let n=t;n<i;n+=1)if(e[n]!==r)return!1;return i-t===n}function yn(e,t){let n=e.action;if(n?.type!==`URI`||!n.uri)return null;try{let e;try{e=new URL(n.uri)}catch{let r=n.uriBase?new URL(n.uriBase,t).href:t;e=new URL(n.uri,r)}return e.protocol===`https:`||e.protocol===`http:`?e.href:null}catch{return null}}function bn(e){return e.action?e.action.type===`GoTo`?e.action.destination:void 0:e.destination}function xn(e,t,n,r){let o=bn(t);if(o?.sourcePageIndex===void 0||r.width<=0||r.height<=0)return null;let s=e.pdfPages?.find(e=>e.sourcePageIndex===o.sourcePageIndex),c=s?.pageIndex??e.annotations?.find(e=>e.sourcePageIndex===o.sourcePageIndex)?.pageIndex;if(c===void 0||c<0||c>=e.pageCount)return null;let l=c*4,u=e.pageRects,d={minX:u[l],minY:u[l+1],maxX:u[l+2],maxY:u[l+3]},f=Math.max(1,r.width-48),p=Math.max(1,r.height-48),m=e=>({centerX:(e.minX+e.maxX)/2,centerY:(e.minY+e.maxY)/2,zoom:Math.min(f/(e.maxX-e.minX),p/(e.maxY-e.minY))}),h=m(d);if(!Object.values(h).every(Number.isFinite)||h.zoom<=0)return null;if(!s)return h;let g=o.parameters??[],_=e=>typeof g[e]==`number`&&Number.isFinite(g[e])?g[e]:null,[v,y,b,x,S,C]=s.pdfToScene,w=v*x-y*b;if(!Number.isFinite(w)||w===0)return null;let T=Math.max(d.minX,Math.min(d.maxX,n.centerX)),E=Math.max(d.minY,Math.min(d.maxY,n.centerY)),D=(x*(T-S)-b*(E-C))/w,O=(-y*(T-S)+v*(E-C))/w,k=(e,t)=>i([e,t],s.pdfToScene),A;switch(o.fit??`Fit`){case`Fit`:case`FitB`:A=h;break;case`FitR`:{let e=[_(0),_(1),_(2),_(3)];if(e.some(e=>e===null))return null;let[t,n,r,i]=e;if(r<=t||i<=n)return null;A=m(a([t,n,r,i],s.pdfToScene));break}case`XYZ`:{let[e,t]=k(_(0)??D,_(1)??O),r=_(2);A={centerX:e,centerY:t,zoom:r&&r>0?r*96/72:Math.max(n.zoom,h.zoom)};break}case`FitH`:case`FitBH`:{let[e,t]=k(D,_(0)??O);A={...h,zoom:f/(d.maxX-d.minX)},b===0?A.centerY=t:A.centerX=e;break}case`FitV`:case`FitBV`:{let[e,t]=k(_(0)??D,O);A={...h,zoom:p/(d.maxY-d.minY)},y===0?A.centerX=e:A.centerY=t;break}default:return null}return Object.values(A).every(Number.isFinite)&&A.zoom>0?A:null}function Sn(e){let t=e.getCanvas().ownerDocument.defaultView,n=new AbortController,r=0,i=!1;function a(){r&&t.cancelAnimationFrame(r),r=0}for(let r of[`pointerdown`,`wheel`])t.addEventListener(r,t=>{(r===`pointerdown`||t.target===e.getCanvas())&&a()},{capture:!0,passive:!0,signal:n.signal});t.addEventListener(`keydown`,e=>{e.key!==`Enter`&&a()},{signal:n.signal}),t.addEventListener(`blur`,a,{signal:n.signal});function o(){let t=e.getSourceUrl?.();if(t)try{return new URL(t,e.getCanvas().ownerDocument.baseURI).href}catch{return}}return{getActivationLabel(t){if(i)return null;if(yn(t,o()))return`Open link in new tab`;let n=e.getScene(),r=e.getView();return n&&r&&xn(n,t,r,e.getCanvas().getBoundingClientRect())?`Go to destination`:null},activate(n){if(i)return!1;let s=yn(n,o());if(s)return a(),t.open(s,`_blank`,`noopener,noreferrer`),!0;let c=e.getScene(),l=e.getView();if(!c||!l||!Object.values(l).every(Number.isFinite)||l.zoom<=0)return!1;let u=e.getCanvas().getBoundingClientRect(),d=xn(c,n,l,u);if(!d)return!1;if(a(),e.beforeNavigate?.(),t.matchMedia?.(`(prefers-reduced-motion: reduce)`).matches)return e.setView(d),!0;let f=e.getIdentity(),p=t.performance.now(),m=d.centerX-l.centerX,h=d.centerY-l.centerY,g=Math.hypot(m/u.width,h/u.height)*Math.min(l.zoom,d.zoom),_=450+Math.min(750,200*Math.log2(1+g)),v=Math.min(Math.log(32),Math.log(Math.hypot(1,g))),y=Math.log(l.zoom),b=Math.log(d.zoom);function x(n){if(r=0,i||e.getScene()!==c||e.getIdentity()!==f)return;let a=Math.min(1,Math.max(0,(n-p)/_));if(a===1){e.setView(d);return}let o=a*a*(3-2*a),s=4*o*(1-o);e.setView({centerX:l.centerX+m*o,centerY:l.centerY+h*o,zoom:Math.exp(y+(b-y)*o-v*s)}),r=t.requestAnimationFrame(x)}return r=t.requestAnimationFrame(x),!0},cancel:a,dispose(){i=!0,a(),n.abort()}}}function Cn(e){return e.subtype===`Link`||e.destination!==void 0||e.action?.type===`URI`||e.action?.type===`GoTo`||e.action?.type===`GoToR`}var wn=new WeakMap;function Tn(e,t,n){if(e.subtype===`Popup`||e.flags&35)return!1;if(e.optionalContent===void 0)return e.visibleInDefaultView;let r=n;return r||(r=wn.get(t),r||(r=l(t),wn.set(t,r))),r.conditions[e.optionalContent]!==0&&r.conditions[e.optionalContent]!==void 0}function En(e,t,n){let r=t*4,i=e.pageRects;return n.x>=i[r]&&n.y>=i[r+1]&&n.x<=i[r+2]&&n.y<=i[r+3]}function Dn(e,t,n){let r=Array.from({length:4},(n,r)=>({x:e[t+r*2],y:e[t+r*2+1]})),i=r.reduce((e,t)=>e+t.x,0)/4,a=r.reduce((e,t)=>e+t.y,0)/4;r.sort((e,t)=>Math.atan2(e.y-a,e.x-i)-Math.atan2(t.y-a,t.x-i));let o=!1,s=!1;for(let e=0;e<4;e++){let t=r[e],i=r[(e+1)%4],a=(i.x-t.x)*(n.y-t.y)-(i.y-t.y)*(n.x-t.x);o||=a>1e-8,s||=a<-1e-8}return!(o&&s)&&(o||s)}function On(e,t,n){let r=n.x-t.x,i=n.y-t.y,a=r*r+i*i,o=a?Math.max(0,Math.min(1,((e.x-t.x)*r+(e.y-t.y)*i)/a)):0;return Math.hypot(e.x-t.x-o*r,e.y-t.y-o*i)}function kn(e,t,n,r){let i=r.clientToScenePoint(t,n);if(!i)return null;let a=r.getOptionalContentVisibility?.(),o=null,s=1/0;for(let c of e.annotations??[]){if(!Tn(c,e,a)||r.isAnnotationEnabled?.(c)===!1||!En(e,c.pageIndex,i))continue;let l=c.bounds,u=!1,d=(l.maxX-l.minX)*(l.maxY-l.minY);if(c.quadPoints?.length){for(let e=0;e<c.quadPoints.length;e+=8)if(Dn(c.quadPoints,e,i)){u=!0;let t=c.quadPoints;d=Math.min(d,(Math.max(t[e],t[e+2],t[e+4],t[e+6])-Math.min(t[e],t[e+2],t[e+4],t[e+6]))*(Math.max(t[e+1],t[e+3],t[e+5],t[e+7])-Math.min(t[e+1],t[e+3],t[e+5],t[e+7])))}}else if(c.inkList?.length){let e=c.pdfGeometry.rect,i=Math.abs((e[2]-e[0])*(e[3]-e[1])),a=i>0?Math.sqrt(d/i):1,o=(c.border?.width??1)*a/2;for(let e of c.inkList){for(let i=0;i<e.length;i+=2){let a=r.sceneToClientPoint(e[i],e[i+1]),s=r.sceneToClientPoint(e[Math.min(i+2,e.length-2)],e[Math.min(i+3,e.length-1)]);if(!a||!s)continue;let c=r.sceneToClientPoint(e[i]+o,e[i+1]),l=r.sceneToClientPoint(e[i],e[i+1]+o),d=Math.max(c?Math.hypot(c.x-a.x,c.y-a.y):0,l?Math.hypot(l.x-a.x,l.y-a.y):0);if(On({x:t,y:n},a,s)<=5+d){u=!0;break}}if(u)break}}else u=i.x>=l.minX&&i.x<=l.maxX&&i.y>=l.minY&&i.y<=l.maxY;u&&d<=s&&(o=c,s=d)}return o}function An(e,t){let n=t.ownerDocument,r=n.createElement(`strong`);if(r.textContent=e.tooltip||e.subject||e.field?.name||e.subtype,t.appendChild(r),e.contents){let r=n.createElement(`div`);r.style.cssText=`white-space:pre-wrap;margin-top:6px;`,r.textContent=e.contents,t.appendChild(r)}let i=[e.author,e.modificationDate??e.creationDate];if(e.field?.value!==void 0&&e.field.value!==null&&!(e.field.flags&8192)&&i.push(String(e.field.value)),e.action){let t=e.action;i.push(t.uri??t.file??t.name??t.destination?.name??t.type)}else e.destination&&i.push(e.destination.name??(e.destination.sourcePageIndex===void 0?`Destination`:`Page ${e.destination.sourcePageIndex+1}`));let a=n.createElement(`div`);a.style.cssText=`white-space:pre-wrap;margin-top:6px;font-size:12px;opacity:.75;`,a.textContent=i.filter(Boolean).join(`
`),t.appendChild(a)}function jn(e){let{adapter:t}=e,n=e.getCanvas()?.ownerDocument??globalThis.document,r=n.defaultView,i=n.createElement(`div`);i.className=`hepr-annotation-bubble`,i.setAttribute(`role`,`dialog`),i.setAttribute(`aria-label`,`PDF annotation`),i.style.cssText=`position:fixed;z-index:10001;box-sizing:border-box;max-width:min(360px,calc(100vw - 16px));max-height:min(320px,calc(100vh - 16px));overflow:auto;padding:12px 36px 12px 14px;border:1px solid #9ca3af;border-radius:8px;background:#fff;color:#111827;box-shadow:0 4px 16px #0003;font:14px/1.4 system-ui,sans-serif;overflow-wrap:anywhere;user-select:text;-webkit-user-select:text;pointer-events:auto;`,i.hidden=!0;let a=n.createElement(`button`);a.type=`button`,a.textContent=`×`,a.setAttribute(`aria-label`,`Close annotation`),a.style.cssText=`position:absolute;top:4px;right:5px;border:0;background:transparent;color:inherit;font:22px system-ui;cursor:pointer;`;let o=n.createElement(`div`),s=n.createElement(`button`);s.type=`button`,s.hidden=!0,s.style.cssText=`margin-top:10px;padding:5px 9px;border:1px solid #9ca3af;border-radius:4px;background:#fff;color:#1d4ed8;font:inherit;cursor:pointer;`;let c=`data-hepr-annotation-hover`,l=n.createElement(`style`);l.textContent=`canvas[${c}] { cursor: pointer !important; }`,i.appendChild(a),i.appendChild(o),i.appendChild(s),i.appendChild(l),n.body.appendChild(i);let u=new AbortController,d={capture:!0,signal:u.signal},f=e.enabled!==!1,p=!1,m=t.getScene(),h=null,g=!1,_=null,v=null,y=null,b=new Set,x=0;function S(t){if(e.pointerInteraction===!1)return;let n=t?e.getCanvas():null;v!==n&&(v?.removeAttribute(c),v=n,v?.setAttribute(c,``))}function C(){_=null,S(!1),h&&Cn(h)&&w()}function w(){h=null,g=!1,i.hidden=!0}function T(){let e=t.getScene();m!==e&&(w(),C(),y=null,b.clear(),m=e)}function E(){return!f||p||!!t.isInteractionSuppressed?.()}function D(e){return!!m&&Tn(e,m,t.getOptionalContentVisibility?.())&&t.isAnnotationEnabled?.(e)!==!1}function O(){if(!h||!m)return;if(E()||!D(h)){w();return}let n=h.bounds,a=h.pageIndex*4,o=m.pageRects,s=Math.max(n.minX,o[a]),c=Math.min(n.maxX,o[a+2]),l=Math.max(n.minY,o[a+1]),u=Math.min(n.maxY,o[a+3]);if(s>c||l>u){w();return}let d=Cn(h);if(d&&!_){w();return}let f=d?_:t.sceneToClientPoint((s+c)/2,u),p=e.getCanvas()?.getBoundingClientRect();if(!f||!p||f.x<p.left||f.x>p.right||f.y<p.top||f.y>p.bottom){i.hidden=!0;return}i.hidden=!1;let g=i.offsetWidth,v=i.offsetHeight,y=f.x+12,b=f.y+12;d&&y+g>r.innerWidth-8&&(y=f.x-g-12),d&&b+v>r.innerHeight-8&&(b=f.y-v-12),y=Math.max(8,Math.min(y,r.innerWidth-g-8)),b=Math.max(8,Math.min(b,r.innerHeight-v-8)),i.style.left=`${Math.round(y)}px`,i.style.top=`${Math.round(b)}px`}function k(t,n){h!==t&&(o.replaceChildren(),(e.renderContent??An)(t,o));let r=Cn(t),c=!r&&e.onActivate?e.getActivationLabel?.(t):null;s.hidden=!c,s.textContent=c??``,a.hidden=r,i.setAttribute(`role`,r?`tooltip`:`dialog`),i.setAttribute(`aria-label`,r?`PDF link`:`PDF annotation`),i.style.pointerEvents=r?`none`:`auto`,i.style.userSelect=r?`none`:`text`,i.style.webkitUserSelect=r?`none`:`text`,i.style.paddingRight=r?`14px`:`36px`,i.style.overflow=r?`hidden`:`auto`,h=t,g=n&&!r,O()}function A(){if(x=0,T(),E()){S(!1),w();return}if(y||!_||!m){S(!1);return}let e=kn(m,_.x,_.y,t);S(e!==null),!g&&(e?k(e,!1):w())}function j(){x||=r.requestAnimationFrame(A)}function M(){T(),h&&O(),E()||!_||y||!m?S(!1):e.pointerInteraction!==!1&&j()}function N(e){return!!e.target&&i.contains(e.target)}return r.addEventListener(`pointerdown`,t=>{if(T(),C(),N(t)){h&&!Cn(h)?g=!0:w();return}if(t.target!==e.getCanvas()){w();return}if(e.pointerInteraction!==!1){if(b.add(t.pointerId),y){y.multiple=!0;return}t.button!==0||E()||(y={id:t.pointerId,start:{x:t.clientX,y:t.clientY},time:performance.now(),moved:!1,multiple:b.size>1},g||w())}},d),r.addEventListener(`pointermove`,t=>{if(e.pointerInteraction!==!1){if(y){t.pointerId===y.id&&Math.hypot(t.clientX-y.start.x,t.clientY-y.start.y)>5&&(y.moved=!0);return}if(N(t)){C();return}if(t.target!==e.getCanvas()||t.buttons!==0||t.pointerType===`touch`){C(),g||w();return}_={x:t.clientX,y:t.clientY},j()}},d),r.addEventListener(`pointerout`,t=>{e.pointerInteraction!==!1&&t.target===e.getCanvas()&&(C(),!g&&!i.contains(t.relatedTarget)&&w())},d),r.addEventListener(`pointerup`,n=>{if(e.pointerInteraction===!1||(b.delete(n.pointerId),!y||y.id!==n.pointerId))return;let r=y;if(y=null,n.pointerType!==`touch`&&n.target===e.getCanvas()&&(_={x:n.clientX,y:n.clientY},j()),r.moved||r.multiple||performance.now()-r.time>450||E()||(T(),!m))return;let i=kn(m,n.clientX,n.clientY,t);i&&!e.onActivate?.(i)&&!Cn(i)?k(i,!0):(C(),w())},d),r.addEventListener(`pointercancel`,()=>{y=null,b.clear(),C(),g||w()},d),r.addEventListener(`keydown`,t=>{if(T(),h&&!D(h)&&w(),t.key===`Escape`&&h){let t=i.contains(n.activeElement);C(),w(),t&&e.getCanvas()?.focus()}else if(t.key===`Enter`&&t.target===e.getCanvas()&&h&&!E()){t.preventDefault();let n=h;e.onActivate?.(n)||Cn(n)?(C(),w()):(g=!0,a.focus())}},d),r.addEventListener(`blur`,()=>{y=null,b.clear(),C(),g||w()},{signal:u.signal}),r.addEventListener(`resize`,M,{signal:u.signal}),r.addEventListener(`scroll`,M,d),i.addEventListener(`pointerdown`,e=>e.stopPropagation(),{signal:u.signal}),s.addEventListener(`click`,()=>{T(),h&&!Cn(h)&&!E()&&D(h)&&e.onActivate?.(h)&&(C(),w(),e.getCanvas()?.focus())},{signal:u.signal}),a.addEventListener(`click`,()=>{C(),w(),e.getCanvas()?.focus()},{signal:u.signal}),{enable(){p||(f=!0)},disable(){f=!1,S(!1),w()},isEnabled:()=>f&&!p,show(n,r){T(),e.pointerInteraction===!1&&(_=r??null),!E()&&m?.annotations?.includes(n)&&t.isAnnotationEnabled?.(n)!==!1&&(!Cn(n)||_&&(e.pointerInteraction===!1||kn(m,_.x,_.y,t)===n))?k(n,!0):e.pointerInteraction===!1&&w()},hide(){C(),w()},onFrame:M,sceneChanged:T,dispose(){p||(p=!0,C(),u.abort(),x&&r.cancelAnimationFrame(x),i.remove(),h=null)}}}var Mn=Object.freeze({aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074});function Nn(e,t){return e.gradientMetaA[t*4]===2?(e.gradientMeshRanges?.[t*2+1]??0)/3:0}function Pn(e,t,n){let r=Nn(e,t);if(!Number.isSafeInteger(n)||n<0||n>=r)throw RangeError(`Mesh triangle index is out of range.`);let i=[],a=[],o=e.gradientMeshRanges[t*2]+n*3,s=t*4,c=e.gradientMetaB,l=e.gradientMetaC,u=c[s]*c[s+3]-c[s+1]*c[s+2];for(let t=0;t<3;t++){let n=e.gradientMeshIndices[o+t],r=e.gradientMeshPositions[n*2]-l[s],d=e.gradientMeshPositions[n*2+1]-l[s+1];i.push({x:(c[s+3]*r-c[s+2]*d)/u,y:(-c[s+1]*r+c[s]*d)/u}),a.push(Array.from(e.gradientMeshColors.subarray(n*4,n*4+4)))}return{points:i,colors:a}}function Fn(e,t,n,r,i){let a=e.gradientMeshRanges,o=e.gradientMeshPositions,s=e.gradientMeshColors,c=e.gradientMeshIndices;if(!a||!o||!s||!c)return null;let l=a[t*2],u=l+a[t*2+1];for(let e=u-3;e>=l;e-=3){let t=c[e],a=c[e+1],l=c[e+2],u=o[t*2],d=o[t*2+1],f=o[a*2],p=o[a*2+1],m=o[l*2],h=o[l*2+1],g=(p-h)*(u-m)+(m-f)*(d-h);if(Math.abs(g)<1e-15)continue;let _=((p-h)*(n-m)+(m-f)*(r-h))/g,v=((h-d)*(n-m)+(u-m)*(r-h))/g,y=1-_-v;if(_>=-1e-7&&v>=-1e-7&&y>=-1e-7)return s[t*4+i]*_+s[a*4+i]*v+s[l*4+i]*y}return null}function In(e){let t=new Uint32Array(e.gradientFillPathCount*2),n=0;for(let t=0;t<e.gradientFillPathCount;t++){let r=e.gradientFillPaintMeta[t*4];r>=0&&(n+=Nn(e,r)*3)}let r=new Float32Array(n*6),i=0;for(let n=0;n<e.gradientFillPathCount;n++){let a=e.gradientFillPaintMeta[n*4],o=a>=0?Nn(e,a):0;t.set([i/6,o*3],n*2);for(let t=0;t<o;t++){let n=Pn(e,a,t);for(let e=0;e<3;e++)r.set([n.points[e].x,n.points[e].y,...n.colors[e]],i),i+=6}}return{vertices:r,ranges:t}}function Ln(e,t){let n=Nn(e,t);if(n>65536)throw RangeError(`Mesh highlighting exceeds its triangle budget.`);let r=e.gradientMeshPositions,i=e.gradientMeshIndices,a=e.gradientMeshRanges[t*2],o=new Map,s=(e,t,n,r,i)=>{let a=n-e,s=r-t;if(!a&&!s)return;let c=Math.abs(a)>=Math.abs(s)?0:1,l=c?t:e,u=c?r:n,d=c?a/s:s/a,f=(l<u?c?e:t:c?n:r)-d*Math.min(l,u),p=`${c}:${d}:${f}`,m=o.get(p);m||o.set(p,m={axis:c,slope:d,offset:f,events:[]});let h=(u>l?1:-1)*i;m.events.push({position:Math.min(l,u),delta:h},{position:Math.max(l,u),delta:-h})};for(let e=0;e<n;e++){let t=i[a+e*3]*2,n=i[a+e*3+1]*2,o=i[a+e*3+2]*2,c=r[t],l=r[t+1],u=r[n],d=r[n+1],f=r[o],p=r[o+1],m=(u-c)*(p-l)-(d-l)*(f-c);if(!m)continue;let h=Math.sign(m);s(c,l,u,d,h),s(u,d,f,p,h),s(f,p,c,l,h)}let c=t*4,l=e.gradientMetaB,u=e.gradientMetaC,d=l[c]*l[c+3]-l[c+1]*l[c+2],f=(e,t)=>{let n=e-u[c],r=t-u[c+1];return[(l[c+3]*n-l[c+2]*r)/d,(-l[c+1]*n+l[c]*r)/d]},p=[];for(let e of o.values()){e.events.sort((e,t)=>e.position-t.position);let t=0,n=0;for(let r=0;r<e.events.length;){let i=e.events[r].position,a=t;do t+=e.events[r++].delta;while(r<e.events.length&&e.events[r].position===i);if(!a&&t&&(n=i),a&&!t){let t=e.axis?f(e.slope*n+e.offset,n):f(n,e.slope*n+e.offset),r=e.axis?f(e.slope*i+e.offset,i):f(i,e.slope*i+e.offset);p.push(...t,...r)}}}let m;if(e.gradientMetaA[c+1]>=.5){let t=e.gradientMetaE,n=[f(t[c],t[c+1]),f(t[c+2],t[c+1]),f(t[c+2],t[c+3]),f(t[c],t[c+3])];m=Float32Array.from(n.flatMap((e,t)=>[...e,...n[(t+1)%4]]))}return{edges:Float32Array.from(p),...m?{domainClip:m}:{}}}var Rn=1024,zn=new Float32Array,Bn=new Uint8Array;function Vn(e){let t=e;return{gradientCount:Kn(t.gradientCount),gradientMetaA:Jn(t.gradientMetaA),gradientMetaB:Jn(t.gradientMetaB),gradientMetaC:Jn(t.gradientMetaC),gradientMetaD:Jn(t.gradientMetaD),gradientMetaE:Jn(t.gradientMetaE),gradientLut:Yn(t.gradientLut),gradientMeshRanges:t.gradientMeshRanges,gradientMeshPositions:t.gradientMeshPositions,gradientMeshColors:t.gradientMeshColors,gradientMeshIndices:t.gradientMeshIndices,gradientFillPathCount:Kn(t.gradientFillPathCount),gradientFillSegmentCount:Kn(t.gradientFillSegmentCount),gradientFillPathMetaA:Jn(t.gradientFillPathMetaA),gradientFillPathMetaB:Jn(t.gradientFillPathMetaB),gradientFillPathMetaC:Jn(t.gradientFillPathMetaC),gradientFillPaintMeta:Jn(t.gradientFillPaintMeta),gradientFillSegmentsA:Jn(t.gradientFillSegmentsA),gradientFillSegmentsB:Jn(t.gradientFillSegmentsB),gradientStrokeRunCount:Kn(t.gradientStrokeRunCount),gradientStrokeSegmentCount:Kn(t.gradientStrokeSegmentCount),gradientStrokeRunMetaA:Jn(t.gradientStrokeRunMetaA),gradientStrokeRunMetaB:Jn(t.gradientStrokeRunMetaB),gradientStrokeEndpoints:Jn(t.gradientStrokeEndpoints),gradientStrokePrimitiveMeta:Jn(t.gradientStrokePrimitiveMeta),gradientStrokePrimitiveBounds:Jn(t.gradientStrokePrimitiveBounds),gradientStrokeStyles:Jn(t.gradientStrokeStyles)}}function Hn(e,t){let n=[];for(let t=0;t<e.length;t+=1){let r=e[t];n.push({kind:`raster`,index:t,paintOrder:qn(r.paintOrder,t),pageIndex:Kn(r.pageIndex)})}for(let e=0;e<t.gradientFillPathCount;e+=1){let r=e*4;n.push({kind:`gradient-fill`,index:e,paintOrder:qn(t.gradientFillPaintMeta[r+2],e),pageIndex:Kn(t.gradientFillPaintMeta[r+3])})}for(let e=0;e<t.gradientStrokeRunCount;e+=1){let r=e*4;n.push({kind:`gradient-stroke`,index:e,paintOrder:qn(t.gradientStrokeRunMetaB[r],e),pageIndex:Kn(t.gradientStrokeRunMetaB[r+1])})}return n.sort((e,t)=>{let n=e.pageIndex-t.pageIndex;if(n!==0)return n;let r=e.paintOrder-t.paintOrder;if(r!==0)return r;let i=Gn(e.kind)-Gn(t.kind);return i===0?e.index-t.index:i}),n}function Un(e){let t=new Set;for(let n of e){if(n.kind===`raster`){if(t.has(n.pageIndex))return!0;continue}t.add(n.pageIndex)}return!1}function Wn(e,t,n,r){let i=e&&t;return{splitOrderedGradientPrefix:i,includeGradientPaint:!i,hasMinifiableContent:i?n:r}}function Gn(e){return e===`raster`?0:e===`gradient-fill`?1:2}function Kn(e){let t=Number(e);return Number.isFinite(t)?Math.max(0,Math.trunc(t)):0}function qn(e,t){let n=Number(e);return Number.isFinite(n)?n:t}function Jn(e){return e instanceof Float32Array?e:zn}function Yn(e){return e instanceof Uint8Array?e:Bn}var Xn=`
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
`,Zn=`
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
`,Qn=`
vec4 heprGradientBackground(float encoded) {
  if (encoded < 0.5) return vec4(0.0);
  int rgb = int(encoded) - 1;
  return vec4(float((rgb >> 16) & 255), float((rgb >> 8) & 255), float(rgb & 255), 255.0) / 255.0;
}
`,$n=`
fn heprGradientBackground(encoded: f32) -> vec4f {
  if (encoded < 0.5) { return vec4f(0.0); }
  let rgb = i32(encoded) - 1;
  return vec4f(f32((rgb >> 16) & 255), f32((rgb >> 8) & 255), f32(rgb & 255), 255.0) / 255.0;
}
`;function er(e,t,n,r,i){if(t<0)return 1;if(t>=e.gradientCount)return 0;let a=t*4,o=e.gradientMetaA,s=e.gradientMetaB,c=e.gradientMetaC,l=e.gradientMetaD,u=e.gradientMetaE,d=s[a]*n+s[a+2]*r+c[a],f=s[a+1]*n+s[a+3]*r+c[a+1];if(o[a+1]>=.5&&(d<u[a]||f<u[a+1]||d>u[a+2]||f>u[a+3]))return 0;if(o[a]===2){let n=Fn(e,t,d,f,i);if(n!==null)return n;let r=o[a+3];return r<.5?0:i===3?1:(r-1>>>(2-i)*8&255)/255}let p=d-c[a+2],m=f-c[a+3],h=l[a]-c[a+2],g=l[a+1]-c[a+3],_=Math.round(o[a+2]),v=e=>Number.isFinite(e)&&(e>=0||!(_&1))&&(e<=1||!(_&2)),y=NaN;if(o[a]<.5){let e=h*h+g*g;e>1e-12&&(y=(p*h+m*g)/e),v(y)||(y=NaN)}else{let e=l[a+2],t=l[a+3]-e,n=h*h+g*g-t*t,r=-2*(p*h+m*g+e*t),i=p*p+m*m-e*e,o=NaN,s=NaN;if(Math.abs(n)<=1e-10)Math.abs(r)>1e-10&&(o=-i/r);else{let e=r*r-4*n*i;if(e>=0){let t=Math.sqrt(e);o=(-r-t)/(2*n),s=(-r+t)/(2*n)}}v(o)&&e+o*t>=0&&(y=o),v(s)&&e+s*t>=0&&(!Number.isFinite(y)||s>y)&&(y=s)}if(!Number.isFinite(y)){let e=o[a+3];return e<.5?0:i===3?1:(e-1>>>(2-i)*8&255)/255}let b=Math.max(0,Math.min(1,y))*(Rn-1),x=Math.floor(b),S=b-x,C=t*Rn*4,w=e.gradientLut[C+x*4+i],T=e.gradientLut[C+Math.min(x+1,Rn-1)*4+i];return(w*(1-S)+T*S)/255}var tr=[`stroke`,`fill`,`text`,`raster`,`gradient-fill`,`gradient-stroke`],nr=.001,rr=134217728,ir=1024,ar=.05;function or(e){return[e.segmentCount,e.fillPathCount,e.textInstanceCount,e.rasterLayers.length,e.gradientFillPathCount,e.gradientStrokeRunCount]}function sr(e,t){let n=t?tr.indexOf(t.kind):-1;if(n<0||!Number.isSafeInteger(t.index)||t.index<0||t.index>=or(e)[n])throw RangeError(`Primitive reference is outside the loaded scene.`)}var cr=new WeakMap,lr=new WeakMap,ur=new WeakMap;function dr(e){let t=cr.get(e);if(!t){let n=e.paintGraph?h(e):e.drawRuns??x(e),r=new Map;for(let e of n){let t=r.get(e.kind);t||r.set(e.kind,t=[]),t.push(e)}for(let e of r.values())e.sort((e,t)=>e.first-t.first);t={runs:n,byKind:r},cr.set(e,t)}return t}function fr(e,t){let n=dr(e).byKind.get(t.kind)??[],r=n[br(n,t.index)];return r&&t.index<r.first+r.count?r:void 0}function pr(e){let t=lr.get(e);if(!t){let n=new Map;if(!f(e.optionalContent).size)return lr.set(e,n),n;let r=e.paintGraph?h(e):e.drawRuns??x(e);for(let t of r){if(!t.count||!g(e,t,()=>!0))continue;let r=mr(e,t);if(r===void 0)continue;let i=n.get(r);i||n.set(r,i=[]),i.push(t)}lr.set(e,t=n)}return t}function mr(e,t){let n=f(e.optionalContent);if(!n.size)return;let r=ur.get(e);r||ur.set(e,r=new Map);let i=t=>{if(r.has(t))return r.get(t);let a=e.optionalContent?.conditions[t],o=a?.kind===`group`?n.get(a.groupId):a?.kind===`not`?i(a.operand):a?.kind===`and`||a?.kind===`or`?a.operands.map(i).find(e=>e!==void 0):void 0;return r.set(t,o),o};return c(e,t,!1).map(i).find(e=>e!==void 0)}function hr(e,t){return Rr(e,t)}function gr(e,t){sr(e,t);let n=y(e,t);return n&&{...n}}function _r(e,t){sr(e,t);let n=fr(e,t)?.optionalContent??null,r=f(e.optionalContent),i=new Set,a=new Set,o=c(e,fr(e,t)),s=mr(e,fr(e,t));for(;o.length;){let t=o.pop();if(a.has(t))continue;a.add(t);let n=e.optionalContent?.conditions[t];n?.kind===`group`?r.get(n.groupId)===void 0&&i.add(n.groupId):n?.kind===`not`?o.push(n.operand):(n?.kind===`and`||n?.kind===`or`)&&o.push(...n.operands)}let l=y(e,t);return{optionalContent:{conditionId:n,layerIds:[...i]},...s===void 0?{}:{annotationId:s},...l?{markedContent:{...l}}:{}}}function vr(e,t){return fr(e,t)?.optionalContent}function yr(e,t,n){return g(e,fr(e,t),n)}function br(e,t){let n=0,r=e.length;for(;n<r;){let i=n+r>>>1;e[i].first<=t?n=i+1:r=i}return n-1}function xr(e,t){sr(e,t);let n;if(t.kind===`stroke`&&(n=Cr(e.primitiveMeta,e.primitiveBounds,t.index)),t.kind===`text`){let r=Math.round(e.textInstanceB[t.index*4+3])-1;r>=0&&e.textClipRects&&(n=Er(e.textClipRects,r*4))}return{clipIndex:fr(e,t)?.clipIndex??-1,...n?{rect:n}:{}}}function Sr(e,t,n){sr(e,t);let r=Pr(e,t);return Fr(n,r.count),t.kind===`gradient-stroke`?Cr(e.gradientStrokePrimitiveMeta,e.gradientStrokePrimitiveBounds,r.first+n):xr(e,t).rect}function Cr(e,t,n){return wr(e[n*4+3])&4?Er(t,n*4):void 0}function wr(e){return Math.floor(e/2+1e-6)}function Tr(e){return Math.max(0,Math.min(1,e-wr(e)*2))}function Er(e,t){return{minX:e[t],minY:e[t+1],maxX:e[t+2],maxY:e[t+3]}}function Dr(){return{minX:1/0,minY:1/0,maxX:-1/0,maxY:-1/0}}function Or(e,t,n=0){e.minX=Math.min(e.minX,t.x-n),e.minY=Math.min(e.minY,t.y-n),e.maxX=Math.max(e.maxX,t.x+n),e.maxY=Math.max(e.maxY,t.y+n)}function kr(e,t){return e.x>=t.minX&&e.x<=t.maxX&&e.y>=t.minY&&e.y<=t.maxY}function Ar(e){return!!e&&Number.isFinite(e.x)&&Number.isFinite(e.y)}function jr(e,t){return{x:t[0]*e.x+t[2]*e.y+t[4],y:t[1]*e.x+t[3]*e.y+t[5]}}function Mr(e,t){let n=t[0]*t[3]-t[1]*t[2];if(!Number.isFinite(n)||Math.abs(n)<1e-20)return null;let r=e.x-t[4],i=e.y-t[5];return{x:(t[3]*r-t[2]*i)/n,y:(t[0]*i-t[1]*r)/n}}function Nr(e,t){let n=t*4;return[e.textInstanceA[n],e.textInstanceA[n+1],e.textInstanceA[n+2],e.textInstanceA[n+3],e.textInstanceB[n],e.textInstanceB[n+1]]}function Pr(e,t){let n=t.index*4;switch(t.kind){case`stroke`:return{a:e.endpoints,b:e.primitiveMeta,first:t.index,count:1};case`gradient-stroke`:return{a:e.gradientStrokeEndpoints,b:e.gradientStrokePrimitiveMeta,first:Math.round(e.gradientStrokeRunMetaA[n]),count:Math.round(e.gradientStrokeRunMetaA[n+1])};case`fill`:return{a:e.fillSegmentsA,b:e.fillSegmentsB,first:Math.round(e.fillPathMetaA[n]),count:Math.round(e.fillPathMetaA[n+1])};case`gradient-fill`:return{a:e.gradientFillSegmentsA,b:e.gradientFillSegmentsB,first:Math.round(e.gradientFillPathMetaA[n]),count:Math.round(e.gradientFillPathMetaA[n+1])};case`text`:{let r=Math.round(e.textInstanceB[n+2])*4;return{a:e.textGlyphSegmentsA,b:e.textGlyphSegmentsB,first:Math.round(e.textGlyphMetaA[r]),count:Math.round(e.textGlyphMetaA[r+1]),matrix:Nr(e,t.index)}}case`raster`:return{a:e.endpoints,b:e.primitiveMeta,first:0,count:4}}}function Fr(e,t){if(!Number.isSafeInteger(e)||e<0||e>=t)throw RangeError(`Primitive segment index is out of range.`)}function Ir(e,t){let n=(e.first+t)*4,r={x:e.a[n],y:e.a[n+1]},i={x:e.b[n],y:e.b[n+1]},a=e.b[n+2]>=.5?{x:e.a[n+2],y:e.a[n+3]}:void 0;return{start:e.matrix?jr(r,e.matrix):r,end:e.matrix?jr(i,e.matrix):i,...a?{control:e.matrix?jr(a,e.matrix):a}:{}}}function Lr(e,t,n){return[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}].map(r=>jr(r,(n??e.rasterLayers[t]).matrix))}function Rr(e,t){let n=t.index*4;if(t.kind===`fill`||t.kind===`gradient-fill`){let r=t.kind===`fill`?e.fillPathMetaA:e.gradientFillPathMetaA,i=t.kind===`fill`?e.fillPathMetaB:e.gradientFillPathMetaB;return{minX:r[n+2],minY:r[n+3],maxX:i[n],maxY:i[n+1]}}let r=Dr();if(t.kind===`raster`){let n=v(e,t.index);if(n)return{...n};let i=e.rasterLayers[t.index].repeat;if(i)return j(i);for(let n of Lr(e,t.index))Or(r,n)}else if(t.kind===`text`){let i=Math.round(e.textInstanceB[n+2])*4,a=Nr(e,t.index);for(let t of[e.textGlyphMetaA[i+2],e.textGlyphMetaB[i]])for(let n of[e.textGlyphMetaA[i+3],e.textGlyphMetaB[i+1]])Or(r,jr({x:t,y:n},a))}else{let n=Pr(e,t),i=t.kind===`stroke`?e.styles:e.gradientStrokeStyles;for(let e=0;e<n.count;e++){let t=Ir(n,e),a=Math.max(0,i[(n.first+e)*4]);Or(r,t.start,a),Or(r,t.end,a),t.control&&Or(r,t.control,a)}}return r}function zr(e,t,n){if(t.kind===`raster`)return e.rasterLayers[t.index].pageIndex;if(t.kind===`gradient-fill`)return e.gradientFillPaintMeta[t.index*4+3];if(t.kind===`gradient-stroke`)return e.gradientStrokeRunMetaB[t.index*4+1];if(t.kind===`text`){for(let n=0;n<e.pageTextRanges.length;n+=2)if(t.index>=e.pageTextRanges[n]&&t.index<e.pageTextRanges[n]+e.pageTextRanges[n+1])return n/2}let r=null;for(let t=0;t<e.pageRects.length;t+=4){let i=Er(e.pageRects,t);if(!(n.maxX<i.minX||n.minX>i.maxX||n.maxY<i.minY||n.minY>i.maxY)){if(r!==null)return null;r=t/4}}return r}function Br(e,t){sr(e,t);let n={...t},r=n.index*4,i=Pr(e,n),a=null,o=1,s;if(n.kind===`stroke`||n.kind===`gradient-stroke`){let t=n.kind===`stroke`?e.styles:e.gradientStrokeStyles,s=i.first*4;a=[t[s+1],t[s+2],t[s+3]],o=i.count?Tr(i.b[s+3]):0;for(let e=1;e<i.count;e++){let n=(i.first+e)*4;a&&a.some((e,r)=>e!==t[n+r+1])&&(a=null),o!==Tr(i.b[n+3])&&(o=null)}n.kind===`gradient-stroke`&&e.gradientStrokeRunMetaA[r+2]>=0&&(a=null)}else if(n.kind===`fill`||n.kind===`gradient-fill`){let t=n.kind===`fill`?e.fillPathMetaB:e.gradientFillPathMetaB,i=n.kind===`fill`?e.fillPathMetaC:e.gradientFillPathMetaC;a=[t[r+2],t[r+3],i[r+2]],o=i[r+3],s=i[r]>=.5?`evenodd`:`nonzero`,n.kind===`gradient-fill`&&e.gradientFillPaintMeta[r]>=0&&(a=null)}else n.kind===`text`&&(a=[e.textInstanceC[r],e.textInstanceC[r+1],e.textInstanceC[r+2]],o=e.textInstanceC[r+3],s=`nonzero`);n.kind===`raster`&&(o=e.rasterLayers[n.index].opacity??1);let c=Rr(e,n),l=n.kind===`raster`?Lr(e,n.index):void 0,u=n.kind===`gradient-fill`?e.gradientFillPaintMeta:n.kind===`gradient-stroke`?e.gradientStrokeRunMetaA:void 0,d=n.kind===`gradient-stroke`?2:0,f=u&&u[r+d]>=0?u[r+d]:null,p=u&&u[r+d+1]>=0?u[r+d+1]:null,m=f===null?void 0:e.gradientMetaA[f*4]===2?`mesh`:e.gradientMetaA[f*4]===1?`radial`:`axial`;return{ref:{...n},..._r(e,n),kind:n.kind,index:n.index,bounds:c,pageIndex:zr(e,n,c),color:a,opacity:o,segmentCount:i.count,...s?{fillRule:s}:{},...u?{gradientIndex:f,maskGradientIndex:p}:{},...m?{shadingKind:m}:{},...m===`mesh`?{triangleCount:Nn(e,f),getTriangle:t=>Pn(e,f,t)}:{},...n.kind===`stroke`?{strokeWidth:2*e.styles[r]}:{},...l?{quad:l,width:e.rasterLayers[n.index].width,height:e.rasterLayers[n.index].height}:{},getSegment(e){return Fr(e,i.count),l?{start:{...l[e]},end:{...l[(e+1)%4]}}:Ir(i,e)},getSegmentStyle(t){Fr(t,i.count);let a=Sr(e,n,t),o=a?{clipBounds:a}:{};if(n.kind===`stroke`||n.kind===`gradient-stroke`){let r=n.kind===`stroke`?e.styles:e.gradientStrokeStyles,a=(i.first+t)*4,s=i.b[a+3],c=wr(s);return{color:f===null?[r[a+1],r[a+2],r[a+3]]:null,opacity:Tr(s),strokeWidth:2*r[a],hairline:!!(c&1),roundCap:!!(c&2),...o}}if(n.kind===`fill`||n.kind===`gradient-fill`){let t=n.kind===`fill`?e.fillPathMetaB:e.gradientFillPathMetaB,i=n.kind===`fill`?e.fillPathMetaC:e.gradientFillPathMetaC;return{color:f===null?[t[r+2],t[r+3],i[r+2]]:null,opacity:i[r+3],...o}}return n.kind===`text`?{color:[e.textInstanceC[r],e.textInstanceC[r+1],e.textInstanceC[r+2]],opacity:e.textInstanceC[r+3],...o}:{color:null,opacity:e.rasterLayers[n.index].opacity??1,...o}}}}function Vr(e,t,n){return e.y>n.y==t.y>n.y?0:e.x+(n.y-e.y)/(t.y-e.y)*(t.x-e.x)>n.x?t.y>e.y?1:-1:0}function Hr(e,t){if(!e.control)return{x:e.start.x+(e.end.x-e.start.x)*t,y:e.start.y+(e.end.y-e.start.y)*t};let n=1-t;return{x:n*n*e.start.x+2*n*t*e.control.x+t*t*e.end.x,y:n*n*e.start.y+2*n*t*e.control.y+t*t*e.end.y}}function Ur(e,t){if(!e.control)return Vr(e.start,e.end,t);let n=e.start.y-2*e.control.y+e.end.y,r=2*(e.control.y-e.start.y),i=Wr(n,r,e.start.y-t.y),a=0;for(let o of i)if(o>=0&&o<1&&Hr(e,o).x>t.x){let e=2*n*o+r;Math.abs(e)>1e-12&&(a+=e>0?1:-1)}return a}function Wr(e,t,n){if(Math.abs(e)<=1e-14*Math.max(1,Math.abs(t)))return Math.abs(t)>1e-20?[-n/t]:[];let r=t*t-4*e*n;if(r<0)return[];let i=Math.sqrt(r);if(i===0)return[-t/(2*e)];let a=-.5*(t+(t<0?-i:i));return[a/e,n/a]}function Gr(e,t,n,r){if(r&&!kr(t,r))return!1;for(let r=0;n>=0;r++){let i=e.clipPaths?.[n];if(!i||r>=(e.clipPaths?.length??0))return!1;let a=0;for(let e=0;e<i.edges.length;e+=4)a+=Vr({x:i.edges[e],y:i.edges[e+1]},{x:i.edges[e+2],y:i.edges[e+3]},t);if(i.fillRule?Math.abs(a)%2==0:a===0)return!1;n=i.parent}return!0}function Kr(e,t,n){return er(e,t,n.x,n.y,3)}function qr(e,t){let n=Mr(t,e.matrix);if(!n||n.x<0||n.y<0||n.x>1||n.y>1||!e.width||!e.height)return 0;let r=n.x*e.width-.5,i=n.y*e.height-.5,a=Math.floor(r),o=Math.floor(i),s=r-a,c=i-o,l=(t,n)=>e.data[(Math.max(0,Math.min(e.height-1,n))*e.width+Math.max(0,Math.min(e.width-1,t)))*4+3]/255;return(e.opacity??1)*((l(a,o)*(1-s)+l(a+1,o)*s)*(1-c)+(l(a,o+1)*(1-s)+l(a+1,o+1)*s)*c)}var Jr=new WeakMap;async function Yr(e,t){let n=e.data,r=e.width*e.height,i=Jr.get(n);if(i?.has(r))return i.get(r);let a=[n[0]/255,n[1]/255,n[2]/255,n[3]/255];for(let e=4;e<r*4;e+=4)if(t.shouldYield()&&await t.yield(),n[e]!==n[0]||n[e+1]!==n[1]||n[e+2]!==n[2]||n[e+3]!==n[3]){a=null;break}return i||Jr.set(n,i=new Map),i.set(r,a),a}function Xr(e,t){let n=t.x*e.width-.5,r=t.y*e.height-.5,i=Math.floor(n),a=Math.floor(r),o=n-i,s=r-a,c=t=>{let n=(n,r)=>{let i=(Math.max(0,Math.min(e.height-1,r))*e.width+Math.max(0,Math.min(e.width-1,n)))*4;return e.data[i+t]/255*(t===3?1:e.data[i+3]/255)};return(n(i,a)*(1-o)+n(i+1,a)*o)*(1-s)+(n(i,a+1)*(1-o)+n(i+1,a+1)*o)*s},l=c(3),u=e.opacity??1;return{color:[c(0)*u,c(1)*u,c(2)*u,l*u],shape:l}}async function Zr(e,t,n){let r={color:[0,0,0,0],shape:0};if(!e.width||!e.height)return r;if(n.shouldYield()&&await n.yield(),!e.repeat){let n=Mr(t,e.matrix);return n&&n.x>=0&&n.x<=1&&n.y>=0&&n.y<=1?Xr(e,n):r}let i=A(e.repeat,t.x,t.y);if(!i)return r;let a=(i.xLast-i.xFirst+1)*(i.yLast-i.yFirst+1),o=a>1?await Yr(e,n):null;if(o){let t=o[3],n=-Math.expm1(a*Math.log1p(-t*(e.opacity??1)));return{color:[o[0]*n,o[1]*n,o[2]*n,n],shape:-Math.expm1(a*Math.log1p(-t))}}let s=[0,0,0,0],c=0;for(let r of k(e.repeat,t.x,t.y,i)){n.shouldYield()&&await n.yield();let t=Xr(e,r),i=1-t.color[3];for(let e=0;e<4;e++)s[e]=t.color[e]+s[e]*i;c=t.shape+c*(1-t.shape)}return{color:s,shape:c}}function Qr(e,t,n){let r=t.x-e.x,i=t.y-e.y,a=r*r+i*i,o=a?Math.max(0,Math.min(1,((n.x-e.x)*r+(n.y-e.y)*i)/a)):0;return{t:o,distance:Math.hypot(n.x-e.x-o*r,n.y-e.y-o*i)}}async function $r(e,t,n,r){let i=null,a=r??(t=>Hr(e,t)),o=async(s,c,l,u,d)=>{n.shouldYield()&&await n.yield();let f=(s+c)*.5,p=t.project(a(f));if(!Ar(l)||!Ar(u)||!Ar(p)){d<12&&(l||u||p)&&(await o(s,f,l,p,d+1),await o(f,c,p,u,d+1));return}let m=t.project(a((s+f)*.5)),h=t.project(a((f+c)*.5)),g=Math.max(Qr(l,u,p).distance,Ar(m)?Qr(l,u,m).distance:1/0,Ar(h)?Qr(l,u,h).distance:1/0);if(d<16&&g>ar){await o(s,f,l,p,d+1),await o(f,c,p,u,d+1);return}let _=Qr(l,u,t.clientPoint),v={x:l.x+(u.x-l.x)*_.t,y:l.y+(u.y-l.y)*_.t},y;if(!e.control&&!r)y=t.unproject(v)??a(s+(c-s)*_.t);else{let e=s,n=c;for(let r=0;r<18;r++){let r=e+(n-e)/3,i=n-(n-e)/3,o=t.project(a(r)),s=t.project(a(i));if(!o||!s)break;Math.hypot(o.x-t.clientPoint.x,o.y-t.clientPoint.y)<=Math.hypot(s.x-t.clientPoint.x,s.y-t.clientPoint.y)?n=i:e=r}let r=[s,c,(e+n)*.5],i=r[0],o=1/0;for(let e of r){let n=t.project(a(e)),r=n?Math.hypot(n.x-t.clientPoint.x,n.y-t.clientPoint.y):1/0;r<o&&(o=r,i=e)}y=a(i)}let b=t.project(y);if(!Ar(b))return;let x=Math.hypot(b.x-t.clientPoint.x,b.y-t.clientPoint.y);(!i||x<i.distance)&&(i={point:y,distance:x})};return await o(0,1,t.project(a(0)),t.project(a(1)),0),i}async function ei(e,t,n,r,i){if(t<=0)return i;let a=e.control?await $r(e,{...n,clientPoint:n.point,project:e=>e,unproject:e=>e},r):{distance:Qr(e.start,e.end,n.point).distance};if(a&&a.distance<=t+1e-10)return{point:{...n.point},distance:0};let o=null,s=async(e,t=!1)=>{let i=await $r({start:e(0),end:e(1)},n,r,t?void 0:e);i&&(!o||i.distance<o.distance)&&(o=i)},c=t=>{let n=e.control,r=n?(1-t)*(n.x-e.start.x)+t*(e.end.x-n.x):e.end.x-e.start.x,i=n?(1-t)*(n.y-e.start.y)+t*(e.end.y-n.y):e.end.y-e.start.y,a=Math.hypot(r,i);return a<=1e-15&&(r=e.end.x-e.start.x,i=e.end.y-e.start.y,a=Math.hypot(r,i)),a?{x:r/a,y:i/a}:{x:1,y:0}};for(let n of[-1,1])await s(r=>{let i=Hr(e,r),a=c(r);return{x:i.x-a.y*t*n,y:i.y+a.x*t*n}},!e.control);let l=async e=>{for(let n=0;n<4;n++)await s(r=>{let i=(n+r)*Math.PI/2;return{x:e.x+t*Math.cos(i),y:e.y+t*Math.sin(i)}})};if(await l(e.start),(e.start.x!==e.end.x||e.start.y!==e.end.y)&&await l(e.end),e.control){let t=e.control.x-e.start.x,n=e.control.y-e.start.y,r=e.end.x-2*e.control.x+e.start.x,i=e.end.y-2*e.control.y+e.start.y,a=Math.abs(r)>=Math.abs(i)?-t/r:-n/i;a>0&&a<1&&Math.hypot(t+a*r,n+a*i)<=1e-10&&await l(Hr(e,a))}return o}var ti=class{operations=0;time=performance.now();check;progressOperations=0;nextProgressOperation=1/0;onProgress;constructor(e){this.check=e}setProgress(e,t){this.operations=0,this.progressOperations=e,this.nextProgressOperation=Math.ceil(e/100),this.onProgress=t}shouldYield(){if(this.check(),this.operations++,this.operations>=this.nextProgressOperation){let e=Math.min(99,Math.floor(this.operations*100/this.progressOperations));this.nextProgressOperation=e===99?1/0:Math.ceil((e+1)*this.progressOperations/100),this.onProgress?.(e),this.check()}return this.operations%ir===0&&performance.now()-this.time>=8}async yield(){this.check(),await new Promise(e=>setTimeout(e,0)),this.time=performance.now(),this.check()}};function ni(e){return e=(e|e<<8)&16711935,e=(e|e<<4)&252645135,e=(e|e<<2)&858993459,(e|e<<1)&1431655765}function ri(e,t){let n=tr.length-1;for(;n&&e<t[n];)n--;return{kind:tr[n],index:e-t[n]}}function ii(e,t,n){let r=t*4;return e[r]<=n.maxX&&e[r+1]<=n.maxY&&e[r+2]>=n.minX&&e[r+3]>=n.minY}function ai(e,t){return e.minX<=t.maxX&&e.minY<=t.maxY&&e.maxX>=t.minX&&e.maxY>=t.minY}function oi(e,t,n){let r=dr(e);if(n){let e=r.byKind.get(t.kind)??[],i=br(e,t.index);return i<0?-1:n.get(t.kind)[i]+t.index-e[i].first}let i=0;for(let e of r.runs){if(e.kind===t.kind&&t.index>=e.first&&t.index<e.first+e.count)return i+t.index-e.first;i+=e.count}return-1}function si(e,t){let n=Dr(),r=!0;for(let i of[-t-1,0,t+1])for(let a of[-t-1,0,t+1]){let t=e.unproject({x:e.clientPoint.x+i,y:e.clientPoint.y+a});Ar(t)?Or(n,t):r=!1}if(r){let n=t+1,i=[[-n,-n],[n,-n],[n,n],[-n,n]].map(([t,n])=>e.unproject({x:e.clientPoint.x+t,y:e.clientPoint.y+n})),a=0;for(let e=0;e<4;e++){let t=i[e],n=i[(e+1)%4],o=i[(e+2)%4];if(!Ar(t)||!Ar(n)||!Ar(o)){r=!1;break}let s=(n.x-t.x)*(o.y-n.y)-(n.y-t.y)*(o.x-n.x);if(!Number.isFinite(s)||s===0||a&&Math.sign(s)!==a){r=!1;break}a=Math.sign(s)}}return r||Object.assign(n,{minX:-1/0,minY:-1/0,maxX:1/0,maxY:1/0}),n}var ci=class{index=null;empty=!1;disposed=!1;building=null;scene;defaultConditions;onBuildProgress;constructor(e,t){this.scene=e,this.defaultConditions=e.optionalContent?l(e).conditions:null,this.onBuildProgress=t}dispose(){this.disposed=!0,this.index=null,cr.delete(this.scene),lr.delete(this.scene),p(this.scene),ur.delete(this.scene)}async pickRanges(e,t){let n=()=>{if(e.signal?.throwIfAborted(),this.disposed)throw new DOMException(`Primitive picker disposed.`,`AbortError`)};n();let r=e.tolerancePx??4;if(!Number.isFinite(r)||r<0)throw RangeError(`Picking tolerance must be a finite nonnegative CSS pixel value.`);if(!Ar(e.point)||!Ar(e.clientPoint))return null;let i=e.isConditionVisible??(e=>e===void 0||!this.defaultConditions||this.defaultConditions[e]===1),a=new ti(n),o=si(e,r),s=null;for(let c of t){let t=c.paintRun??c;if(g(this.scene,t,i))for(let l=c.first;l<c.first+c.count;l++){let u={kind:c.kind,index:l};if(a.shouldYield()&&await a.yield(),e.isVisible?.(u)===!1||!ai(Rr(this.scene,u),o))continue;let f=await this.hit(u,e,r,a);if(!f||s&&f.distancePx>=s.distancePx)continue;let p=await d(this.scene,t,f.closestPoint,{visible:i,sample:(t,n)=>this.samplePaint(t,n,e,a),yield:async()=>{a.shouldYield()&&await a.yield()}});if(p*(p===1?1:(await this.samplePaint(u,f.closestPoint,e,a)).color[3])>nr&&(s=f),s?.distancePx===0)return n(),s}}return n(),s}async pick(e){let t=()=>{if(e.signal?.throwIfAborted(),this.disposed)throw Error(`Primitive picker has been disposed.`)};t();let n=e.tolerancePx??4;if(!Number.isFinite(n)||n<0)throw RangeError(`Picking tolerance must be a finite nonnegative CSS pixel value.`);if(!Ar(e.point)||!Ar(e.clientPoint))return null;if(e.kinds?.some(e=>!tr.includes(e)))throw RangeError(`Unknown primitive kind.`);let r=new ti(t);!this.index&&!this.empty&&(this.building||=this.build(new ti(()=>{if(this.disposed)throw Error(`Primitive picker has been disposed.`)})).catch(e=>{throw this.reportBuildProgress(null),e}).finally(()=>{this.building=null}),await this.waitForBuild(this.building,e.signal),t());let i=e.kinds?new Set(e.kinds):null,a=null,o=-1,s=e.isConditionVisible??(t=>!!e.isVisible||t===void 0||!this.defaultConditions||this.defaultConditions[t]===1),c=async(t,c)=>{if(c<=o||i&&!i.has(t.kind)||e.isVisible?.(t)===!1)return;let l=fr(this.scene,t);if(!g(this.scene,l,s))return;if(!e.isVisible&&!e.isConditionVisible&&this.defaultConditions){let e=vr(this.scene,t);if(e!==void 0&&this.defaultConditions[e]!==1)return}let u=await this.hit(t,e,n,r);if(u){let n=await d(this.scene,l,u.closestPoint,{visible:s,sample:(t,n)=>this.samplePaint(t,n,e,r),yield:async()=>{r.shouldYield()&&await r.yield()}});n*(n===1?1:(await this.samplePaint(t,u.closestPoint,e,r)).color[3])>nr&&(a=u,o=c)}};if(this.index){let t=this.index,a=si(e,n),s=[t.levels.length-1,t.levels[t.levels.length-1]];for(;s.length;){let e=s.pop(),n=s.pop();if(!(t.maxRanks[e]<=o||!ii(t.bounds,e,a))){if(n===0){let n=t.ids[e],s=n*t.groupSize;for(let e=Math.min(s+t.groupSize,t.total)-1;e>=s;e--){let s=ri(e,t.offsets);if(!i||i.has(s.kind)){let e=t.groupSize===1?t.ranks[n]:oi(this.scene,s,t.runRanks);e>o&&(t.groupSize===1||s.kind===`gradient-stroke`||ai(Rr(this.scene,s),a))&&await c(s,e)}r.shouldYield()&&await r.yield()}}else{let r=t.levels[n-1]+2*(e-t.levels[n]),i=r+1,a=t.levels[n-1]+t.sizes[n-1];i<a&&t.maxRanks[i]<t.maxRanks[r]?s.push(n-1,i,n-1,r):(s.push(n-1,r),i<a&&s.push(n-1,i))}r.shouldYield()&&await r.yield()}}}return t(),a}async waitForBuild(e,t){if(!t)return e;t.throwIfAborted();let n=()=>{},r=new Promise((e,r)=>{n=()=>r(t.reason),t.addEventListener(`abort`,n,{once:!0})});try{await Promise.race([e,r])}finally{t.removeEventListener(`abort`,n)}}async build(e){this.reportBuildProgress(0);let t=or(this.scene),n=[],r=0;for(let e of t)n.push(r),r+=e;if(!Number.isSafeInteger(r)||r<0)throw RangeError(`Invalid primitive count.`);if(r===0){this.empty=!0,this.reportBuildProgress(100);return}await e.yield();let i=dr(this.scene),a=i.runs,o=r*128+4096>rr&&a.length*8<rr/2?a.length*8:0,s=Math.floor((rr-o-4096)/128),c=Math.max(1,Math.ceil(r/s)),l=Math.ceil(r/c),u=o?new Map:void 0;if(u)for(let[e,t]of i.byKind)u.set(e,new Float64Array(t.length));let d=[0],f=[l],p=l;for(;f[f.length-1]>1;){let e=Math.ceil(f[f.length-1]/2);d.push(p),f.push(e),p+=e}if(this.onBuildProgress){let t=0,n=0;for(let n of a)t+=n.count,e.shouldYield()&&await e.yield();for(let t=0;t<this.scene.gradientStrokeRunCount;t++)n+=Math.max(0,Math.round(this.scene.gradientStrokeRunMetaA[t*4+1])),e.shouldYield()&&await e.yield();e.setProgress(r+l*9+t+n+p,e=>this.reportBuildProgress(e))}let m=new Uint32Array(l),h=new Uint32Array(l),g=new Uint32Array(l),_=new Float64Array(l*4),v=Dr();for(let t=0;t<r;t++){let r=ri(t,n),i;if(r.kind===`gradient-stroke`){i=Dr();let t=Pr(this.scene,r);for(let n=0;n<t.count;n++){let r=Ir(t,n),a=Math.max(0,this.scene.gradientStrokeStyles[(t.first+n)*4]);Or(i,r.start,a),Or(i,r.end,a),r.control&&Or(i,r.control,a),e.shouldYield()&&await e.yield()}}else i=Rr(this.scene,r);let a=Math.floor(t/c),o=a*4;t%c===0?(_.set([i.minX,i.minY,i.maxX,i.maxY],o),m[a]=a):(_[o]=Math.min(_[o],i.minX),_[o+1]=Math.min(_[o+1],i.minY),_[o+2]=Math.max(_[o+2],i.maxX),_[o+3]=Math.max(_[o+3],i.maxY)),Or(v,{x:i.minX,y:i.minY}),Or(v,{x:i.maxX,y:i.maxY}),e.shouldYield()&&await e.yield()}let y=0;for(let t of a){let r=n[tr.indexOf(t.kind)];u&&(u.get(t.kind)[br(i.byKind.get(t.kind),t.first)]=y);for(let n=t.first;n<t.first+t.count;n++){let t=Math.floor((r+n)/c);h[t]=Math.max(h[t],y++),e.shouldYield()&&await e.yield()}}let b=Math.max(1e-12,v.maxX-v.minX),x=Math.max(1e-12,v.maxY-v.minY);for(let t=0;t<l;t++){let n=t*4,r=Math.max(0,Math.min(65535,Math.floor(((_[n]+_[n+2])*.5-v.minX)/b*65535))),i=Math.max(0,Math.min(65535,Math.floor(((_[n+1]+_[n+3])*.5-v.minY)/x*65535)));g[t]=(ni(r)|ni(i)<<1)>>>0,e.shouldYield()&&await e.yield()}let S=new Uint32Array(l),C=new Uint32Array(256),w=m,T=S;for(let t=0;t<32;t+=8){C.fill(0);for(let n=0;n<l;n++)C[g[w[n]]>>>t&255]++,e.shouldYield()&&await e.yield();let n=0;for(let e=0;e<256;e++){let t=C[e];C[e]=n,n+=t}for(let n=0;n<l;n++){let r=w[n];T[C[g[r]>>>t&255]++]=r,e.shouldYield()&&await e.yield()}[w,T]=[T,w]}let E=new Float64Array(p*4),D=new Uint32Array(p);for(let t=0;t<l;t++){let n=m[t];E.set(_.subarray(n*4,n*4+4),t*4),D[t]=h[n],e.shouldYield()&&await e.yield()}for(let t=1;t<d.length;t++)for(let n=0;n<f[t];n++){let r=d[t]+n,i=d[t-1]+n*2,a=Math.min(i+1,d[t-1]+f[t-1]-1);for(let e=0;e<4;e++)E[r*4+e]=(e<2?Math.min:Math.max)(E[i*4+e],E[a*4+e]);D[r]=Math.max(D[i],D[a]),e.shouldYield()&&await e.yield()}this.index={ids:m,bounds:E,ranks:h,maxRanks:D,levels:d,sizes:f,offsets:n,groupSize:c,total:r,runRanks:u},this.reportBuildProgress(100)}reportBuildProgress(e){if(!this.disposed)try{this.onBuildProgress?.(e)}catch{}}async samplePaint(e,t,n,r){let i={color:[0,0,0,0],shape:0};if(!kr(t,Rr(this.scene,e)))return i;let a=n.project(t);if(!a)return i;let o=await this.hit(e,{...n,point:t,clientPoint:a},0,r,!0);if(!o)return i;if(e.kind===`raster`)return Zr(n.rasterLayers?.get(e.index)??this.scene.rasterLayers[e.index],t,r);let s=Br(this.scene,e),c=s.getSegmentStyle(o.segmentIndex??0),l=c.color??[0,0,0],u=c.opacity;return s.gradientIndex!==void 0&&s.gradientIndex!==null&&(l=[0,1,2].map(e=>er(this.scene,s.gradientIndex,t.x,t.y,e)),u*=Kr(this.scene,s.gradientIndex,t)),s.maskGradientIndex!==void 0&&s.maskGradientIndex!==null&&(u*=Kr(this.scene,s.maskGradientIndex,t)),l=n.resolveColor?.(e,l)??l,{color:[l[0]*u,l[1]*u,l[2]*u,u],shape:1}}async hit(e,t,n,r,i=!1){let a=this.scene,o=e.index*4,s=xr(a,e);if(!Gr(a,t.point,s.clipIndex,s.rect))return null;if(e.kind===`raster`){let o=t.rasterLayers?.get(e.index)??a.rasterLayers[e.index],c=i?{...o,opacity:1}:o;if((c.repeat?(await Zr(c,t.point,r)).color[3]:qr(c,t.point))>nr)return{primitive:{...e},..._r(this.scene,e),point:{...t.point},closestPoint:{...t.point},distancePx:0};let l=Mr(t.point,o.matrix);if(!l||l.x>=0&&l.x<=1&&l.y>=0&&l.y<=1)return null;let u=Lr(a,e.index,o),d=null;for(let e=0;e<4;e++){let n=await $r({start:u[e],end:u[(e+1)%4]},t,r);n&&(!d||n.distance<d.distance)&&(d=n)}return!d||d.distance>n||!Gr(a,d.point,s.clipIndex,s.rect)||(c.repeat?(await Zr(c,d.point,r)).color[3]:qr(c,d.point))<=nr?null:{primitive:{...e},..._r(this.scene,e),point:{...t.point},closestPoint:d.point,distancePx:d.distance}}let c=Pr(a,e),l=e.kind===`stroke`||e.kind===`gradient-stroke`,u=1,d=!1,f=-1,p=-1;if(e.kind===`text`&&(u=a.textInstanceC[o+3]),e.kind===`fill`||e.kind===`gradient-fill`){let t=e.kind===`fill`?a.fillPathMetaC:a.gradientFillPathMetaC;u=t[o+3],d=t[o]>=.5}if(e.kind===`gradient-fill`&&(f=a.gradientFillPaintMeta[o],p=a.gradientFillPaintMeta[o+1]),e.kind===`gradient-stroke`&&(f=a.gradientStrokeRunMetaA[o+2],p=a.gradientStrokeRunMetaA[o+3]),i&&(u=1),u<=nr)return null;let m=0,h=null,g=-1;for(let n=0;n<c.count;n++){let o=Ir(c,n);l||(m+=Ur(o,t.point));let d=await $r(o,t,r);if(d){let m=d.distance,_=d.point,v=s.rect,y=u;if(l){let l=(c.first+n)*4,u=c.b[l+3],f=e.kind===`stroke`?a.styles:a.gradientStrokeStyles,p=e.kind===`gradient-stroke`?Cr(a.gradientStrokePrimitiveMeta,a.gradientStrokePrimitiveBounds,c.first+n):s.rect;if(v=p,y=i?1:Tr(u),!i&&Tr(u)<=nr||p&&!kr(t.point,p)){r.shouldYield()&&await r.yield();continue}if(Math.hypot(o.start.x-o.end.x,o.start.y-o.end.y)<1e-8&&(!o.control||Math.hypot(o.start.x-o.control.x,o.start.y-o.control.y)<1e-8)&&!(wr(u)&2)){r.shouldYield()&&await r.yield();continue}if(!(wr(u)&1)){let e=await ei(o,Math.max(0,f[l]),t,r,d);if(!e){r.shouldYield()&&await r.yield();continue}m=e.distance,_=e.point}else if(m=Math.max(0,m-.5),m===0)_=t.point;else if(d.distance>0){let e=t.project(d.point);e&&(_=t.unproject({x:e.x+(t.clientPoint.x-e.x)*.5/d.distance,y:e.y+(t.clientPoint.y-e.y)*.5/d.distance})??d.point)}}Gr(a,_,s.clipIndex,v)&&y*Kr(a,f,_)*Kr(a,p,_)>nr&&(!h||m<h.distance)&&(h={point:Gr(a,d.point,s.clipIndex,v)?d.point:_,distance:m},g=n)}r.shouldYield()&&await r.yield()}if(!l&&(d?Math.abs(m)%2==1:m!==0)&&u*Kr(a,f,t.point)*Kr(a,p,t.point)>nr)return{primitive:{...e},..._r(this.scene,e),point:{...t.point},closestPoint:{...t.point},distancePx:0};let _=-1;if(!l&&f>=0&&a.gradientMetaA[f*4]===2&&n>0){let e=Nn(a,f),i=f*4;for(let o=0;o<e;o++){let e=Pn(a,f,o);for(let l=0;l<3;l++){let f=e.points[l],m=e.points[(l+1)%3],g=await $r({start:f,end:m},t,r);if(!g||g.distance>n||h&&g.distance>=h.distance||!Gr(a,g.point,s.clipIndex,s.rect))continue;let v=a.gradientMetaB,y=a.gradientMetaC,b=a.gradientMetaE,x=g.point,S=v[i]*x.x+v[i+2]*x.y+y[i],C=v[i+1]*x.x+v[i+3]*x.y+y[i+1];if(a.gradientMetaA[i+1]>=.5&&(S<b[i]||C<b[i+1]||S>b[i+2]||C>b[i+3]))continue;let w=m.x-f.x,T=m.y-f.y,E=w*w+T*T,D=E>0?Math.max(0,Math.min(1,((x.x-f.x)*w+(x.y-f.y)*T)/E)):0,O=e.colors[l][3]*(1-D)+e.colors[(l+1)%3][3]*D;if(u*O*Kr(a,p,x)<=nr)continue;let k=0,A=!1;for(let e=0;e<c.count;e++){let t=Ir(c,e);k+=Ur(t,x),!t.control&&Qr(t.start,t.end,x).distance<1e-7&&(A=!0),r.shouldYield()&&await r.yield()}(A||(d?Math.abs(k)%2==1:k!==0))&&(h=g,_=o)}r.shouldYield()&&await r.yield()}}return!h||h.distance>n+1e-7?null:{primitive:{...e},..._r(this.scene,e),point:{...t.point},closestPoint:h.point,distancePx:h.distance,..._>=0?{triangleIndex:_}:{segmentIndex:g}}}},li=[.15,.45,1],ui=[1,.65,.05];function di(e){return`${e.kind}:${e.index}`}function fi(e){if(Array.isArray(e)){if(e.length!==3||!e.every(Number.isFinite))throw TypeError(`Invalid primitive color channels.`);return e.map(e=>Math.max(0,Math.min(1,e)))}let t;if(typeof e==`number`)t=e;else if(typeof e==`string`){let n=e.trim().toLowerCase();if(/^#[\da-f]{3}$/.test(n))t=parseInt(n.slice(1).split(``).map(e=>e+e).join(``),16);else if(/^#?[\da-f]{6}$/.test(n))t=parseInt(n.replace(/^#/,``),16);else if(Object.hasOwn(Mn,n))t=Mn[n];else throw TypeError(`Unsupported primitive color: ${e}`)}else throw TypeError(`Invalid primitive color.`);if(!Number.isInteger(t)||t<0||t>16777215)throw TypeError(`Invalid primitive color number.`);return[(t>>>16)/255,(t>>>8&255)/255,(t&255)/255]}var pi=class{colors=new Map;selected=[];hover=null;annotationSelected=[];annotationHovered=[];annotationFallback=null;highlights=null;disposed=!1;scene;callbacks;constructor(e,t={}){this.scene=e,this.callbacks=t}getSelection(){return this.selected.map(e=>({...e}))}getHover(){return this.hover&&{...this.hover}}getOverrideColor(e){sr(this.scene,e);let t=this.colors.get(di(e))?.color;return t?[...t]:null}getHighlights(){return this.highlights}getColorUpdates(){return[...this.colors.values()].map(({ref:e,color:t})=>({ref:{...e},color:t&&[...t]}))}hasAnyOverrides(){return this.colors.size>0}hasOverrides(e){for(let t of this.colors.values())if(t.ref.kind===e)return!0;return!1}setHover(e){if(this.assertLive(),e&&sr(this.scene,e),e?this.hover&&di(e)===di(this.hover):!this.hover)return;let t=e&&{...e},n=this.buildHighlights(this.selected,t);this.hover=t,this.highlights=n,this.callbacks.onHighlights?.(n)}setSelection(e){this.assertLive();let t=this.validateRefs(e);if(t.length===this.selected.length&&t.every((e,t)=>di(e)===di(this.selected[t])))return;let n=this.buildHighlights(t,this.hover);this.selected=t,this.highlights=n,this.callbacks.onHighlights?.(n)}setAnnotationHighlights(e,t,n){this.assertLive();let r=this.validateRefs(e),i=this.validateRefs(t),a=hi(mi(this.scene,[...this.selected,...r],[...this.hover?[this.hover]:[],...i],r.length||i.length?262144:1/0,!!(r.length||i.length||n)),n);this.annotationSelected=r,this.annotationHovered=i,this.annotationFallback=n,this.highlights=a,this.callbacks.onHighlights?.(a)}buildHighlights(e,t){return hi(mi(this.scene,[...e,...this.annotationSelected],[...t?[t]:[],...this.annotationHovered],1/0,!!(this.annotationSelected.length||this.annotationHovered.length||this.annotationFallback)),this.annotationFallback)}setOverrides(e,t){this.assertLive();let n=this.validateRefs(e);if(n.some(e=>e.kind===`raster`))throw TypeError(`Raster layers support highlighting, but not color overrides.`);let r=fi(t?.color),i=n.filter(e=>{let t=this.colors.get(di(e))?.color;return!t||t.some((e,t)=>e!==r[t])}).map(e=>({ref:e,color:[...r]}));for(let e of i)this.colors.set(di(e.ref),e);i.length&&this.callbacks.onColors?.(i)}clearOverrides(e){this.assertLive();let t=e===void 0?[...this.colors.values()].map(e=>e.ref):this.validateRefs(e),n=[];for(let e of t)this.colors.delete(di(e))&&n.push({ref:e,color:null});n.length&&this.callbacks.onColors?.(n)}clear(){this.assertLive(),this.clearOverrides();let e=this.highlights!==null;this.selected=[],this.hover=null,this.annotationSelected=[],this.annotationHovered=[],this.annotationFallback=null,this.highlights=null,e&&this.callbacks.onHighlights?.(null)}dispose(){this.disposed||=(this.clear(),!0)}assertLive(){if(this.disposed)throw Error(`Primitive appearance state has been disposed.`)}validateRefs(e){if(!Array.isArray(e))throw TypeError(`Primitive references must be an array.`);let t=new Map;for(let n of e)sr(this.scene,n),t.set(di(n),{...n});return[...t.values()]}};function mi(e,t,n,r=1/0,i=!1){let a=n?Array.isArray(n)?n:[n]:[],o=[...t,...a];if(i){let e=new Map;for(let n of t)e.set(di(n),n);t=[...e.values()],o=[...t];for(let t of a)e.has(di(t))||(e.set(di(t),t),o.push(t))}if(!o.length)return null;let s=new Map,c=0,l=0;for(let n=0;n<o.length;n++){let i=di(o[n]),a=s.get(i);if(!a){let t=Br(e,o[n]),r=t.kind===`gradient-fill`&&t.shadingKind===`mesh`?Ln(e,t.gradientIndex):void 0;s.set(i,a={primitive:t,...r?{mesh:r}:{}})}if(c+=a.mesh?a.mesh.edges.length/4:a.primitive.segmentCount,c>r)throw RangeError(`Annotation highlight trace exceeds its segment budget.`);n===t.length-1&&(l=c)}if(!c)return null;let u=new Float32Array(c*8),d=[],f=new Map,p=new Map,m=t=>{if(t<0)return-1;let n=f.get(t);if(n!==void 0)return n;let r=e.clipPaths?.[t];if(!r)throw RangeError(`Invalid primitive clip reference.`);let i=m(r.parent),a=d.length;return d.push({parent:i,fillRule:r.fillRule,edges:r.edges.slice()}),f.set(t,a),a},h=(e,t)=>{if(!t)return e;let{minX:n,minY:r,maxX:i,maxY:a}=t,o=`${e}:${n}:${r}:${i}:${a}`,s=p.get(o);if(s!==void 0)return s;let c=d.length;return d.push({parent:e,fillRule:0,edges:Float32Array.of(n,r,i,r,i,r,i,a,i,a,n,a,n,a,n,r)}),p.set(o,c),c},g=0,_=new Map;for(let t of o){let n=di(t),{primitive:r,mesh:i}=s.get(n),a=xr(e,t),o=h(m(a.clipIndex),a.rect);if(i){let e=_.get(n);e===void 0&&(e=d.length,d.push({parent:o,fillRule:+(r.fillRule===`evenodd`),edges:gi(r)}),i.domainClip&&(d.push({parent:e,fillRule:0,edges:i.domainClip}),e=d.length-1),_.set(n,e));for(let t=0;t<i.edges.length;t+=4){let n=i.edges[t],r=i.edges[t+1],a=i.edges[t+2],o=i.edges[t+3];u.set([n,r,a,o,a,o,0,e],g),g+=8}continue}for(let n=0;n<r.segmentCount;n++){let i=r.getSegment(n),a=i.control??i.end,s=t.kind===`gradient-stroke`?h(o,Sr(e,t,n)):o;u.set([i.start.x,i.start.y,a.x,a.y,i.end.x,i.end.y,+!!i.control,s],g),g+=8}}return{segments:u,clipPaths:d,selectionCount:l,count:c}}function hi(e,t){if(!e)return t;if(!t)return e;let n=new Float32Array((e.count+t.count)*8),r=[...e.clipPaths,...t.clipPaths.map(t=>({...t,parent:t.parent<0?-1:t.parent+e.clipPaths.length}))],i=0,a=(e,t,r,a)=>{for(let o=t;o<r;o++)n.set(e.segments.subarray(o*8,o*8+8),i),n[i+7]>=0&&(n[i+7]+=a),i+=8};return a(e,0,e.selectionCount,0),a(t,0,t.selectionCount,e.clipPaths.length),a(e,e.selectionCount,e.count,0),a(t,t.selectionCount,t.count,e.clipPaths.length),{segments:n,clipPaths:r,selectionCount:e.selectionCount+t.selectionCount,count:e.count+t.count}}function gi(e){let t=[],n=(e,n,r,i)=>{if(![e,n,r,i].every(Number.isFinite))throw RangeError(`Non-finite mesh highlight clip coordinates.`);(e!==r||n!==i)&&t.push(e,n,r,i)},r=(e,t,r,i,a,o)=>{let s=[e,t,r,i,a,o];if(!s.every(Number.isFinite))throw RangeError(`Non-finite mesh highlight clip coordinates.`);let c=[s];for(;c.length;){let e=c.pop(),[t,r,i,a,o,s]=e,l=o-t,u=s-r,d=Math.max(0,Math.min(1,((i-t)*l+(a-r)*u)/(l*l+u*u||1)));if(Math.hypot(i-t-d*l,a-r-d*u)<=1e-4||e[6]===1){n(t,r,o,s);continue}let f=t/2+i/2,p=r/2+a/2,m=i/2+o/2,h=a/2+s/2,g=f/2+m/2,_=p/2+h/2,v=[t,r,f,p,g,_],y=[g,_,m,h,o,s];v.push(+!!v.every((t,n)=>t===e[n])),y.push(+!!y.every((t,n)=>t===e[n])),c.push(y,v)}};for(let t=0;t<e.segmentCount;t++){let{start:i,control:a,end:o}=e.getSegment(t);a?r(i.x,i.y,a.x,a.y,o.x,o.y):n(i.x,i.y,o.x,o.y)}return Float32Array.from(t)}var _i=65536,vi=65536,yi=new WeakSet;function bi(e,t){return{minX:Math.min(e.minX,t.minX),minY:Math.min(e.minY,t.minY),maxX:Math.max(e.maxX,t.maxX),maxY:Math.max(e.maxY,t.maxY)}}function xi(e,t){return e.minX<=t.maxX&&e.maxX>=t.minX&&e.minY<=t.maxY&&e.maxY>=t.minY}function Si(e){e.sort((e,t)=>e.bounds.minX+e.bounds.maxX-t.bounds.minX-t.bounds.maxX);let t=(n,r)=>{if(n===r)return null;if(r-n===1)return e[n];let i=n+r>>>1,a=t(n,i),o=t(i,r);return{bounds:bi(a.bounds,o.bounds),left:a,right:o}};return t(0,e.length)}function Ci(e,t){let n=[],r=e?[e]:[];for(;r.length;){let e=r.pop();xi(e.bounds,t)&&(e.value===void 0?r.push(e.left,e.right):n.push(e.value))}return n}function wi(e){let{minX:t,minY:n,maxX:r,maxY:i}=e;return{points:[{x:t,y:n},{x:r,y:n},{x:r,y:i},{x:t,y:i}],closed:!0,filled:!0}}function Ti(e){return Array.from({length:e.length/2},(t,n)=>({x:e[n*2],y:e[n*2+1]}))}function Ei(e){if((e.quadPoints?.length??0)/2+(e.vertices?.length??0)/2+(e.line?.length??0)/2+(e.inkList?.reduce((e,t)=>e+t.length/2,0)??0)>_i)return yi.has(e)||(yi.add(e),console.warn(`[HEPR] Annotation ${e.id} metadata exceeds the interaction point budget; using its bounds.`)),[wi(e.bounds)];if(e.quadPoints?.length){let t=[];for(let n=0;n<e.quadPoints.length;n+=8){let r=Ti(e.quadPoints.slice(n,n+8)),i=r.reduce((e,t)=>({x:e.x+t.x/4,y:e.y+t.y/4}),{x:0,y:0});r.sort((e,t)=>Math.atan2(e.y-i.y,e.x-i.x)-Math.atan2(t.y-i.y,t.x-i.x)),t.push({points:r,closed:!0,filled:!0})}return t}return e.inkList?.some(e=>e.length)?e.inkList.filter(e=>e.length).map(e=>({points:Ti(e),closed:!1,filled:!1})):e.vertices?.length?[{points:Ti(e.vertices),closed:e.subtype===`Polygon`,filled:e.subtype===`Polygon`}]:e.line?.length?[{points:Ti(e.line),closed:!1,filled:!1}]:[wi(e.bounds)]}function Di(e,t){return e.subtype===`Popup`||e.flags&35?!1:e.optionalContent===void 0?e.visibleInDefaultView:t.conditions[e.optionalContent]===1}function Oi(e){let t=[],n=new Set;for(let r of e)for(let e=r.first;e<r.first+r.count;e++){let i=`${r.kind}:${e}`;n.has(i)||(n.add(i),t.push({kind:r.kind,index:e}))}return t}var ki=class{entries=new Map;root=null;prepared=!1;building=null;disposed=!1;scene;constructor(e){this.scene=e;let t=pr(e);for(let n of e.annotations??[]){let e=this.entries.get(n.id);e?(e.annotations.push(n),e.bounds=bi(e.bounds,n.bounds)):this.entries.set(n.id,{id:n.id,annotations:[n],runs:t.get(n.id)??[],bounds:{...n.bounds}})}}get(e){if(this.disposed)throw Error(`Annotation index disposed.`);let t=this.entries.get(e);if(!t)throw RangeError(`Unknown annotation: ${e}`);return t}async query(e,t){if(t?.throwIfAborted(),this.disposed||(this.prepared||(this.building??=this.build().finally(()=>{this.building=null}),await m(this.building,t)),this.disposed))throw new DOMException(`Annotation index disposed.`,`AbortError`);return t?.throwIfAborted(),Ci(this.root,e)}appearanceRanges(e,t){return e.geometry?Ci(e.geometry,t):e.runs}dispose(){this.disposed=!0,this.entries.clear(),this.root=null}async build(){let e=0,t=performance.now(),n=[...this.entries.values()].reduce((e,t)=>e+t.runs.reduce((e,t)=>e+t.count,0),0),r=Math.max(64,Math.ceil(n/vi)),i=0,a=!1,o=()=>{if(this.disposed)throw new DOMException(`Annotation index disposed.`,`AbortError`)};for(let n of this.entries.values()){o();let s=[],c=!1;for(let r of n.annotations)for(let i of Ei(r))for(let a of i.points){let i=Ai(r);n.bounds=bi(n.bounds,{minX:a.x-i,minY:a.y-i,maxX:a.x+i,maxY:a.y+i}),++e%1024==0&&performance.now()-t>=8&&(await new Promise(e=>setTimeout(e,0)),o(),t=performance.now())}for(let a of n.runs)for(let l=a.first;l<a.first+a.count;l+=r){let u=Math.min(r,a.first+a.count-l),d={minX:1/0,minY:1/0,maxX:-1/0,maxY:-1/0};for(let n=l;n<l+u;n++)d=bi(d,hr(this.scene,{kind:a.kind,index:n})),++e%1024==0&&performance.now()-t>=8&&(await new Promise(e=>setTimeout(e,0)),o(),t=performance.now());n.bounds=bi(n.bounds,d),i<vi?(i++,s.push({bounds:d,value:{kind:a.kind,first:l,count:u,paintRun:a}})):c=!0}n.geometry=c?null:Si(s),c&&!a&&(a=!0,console.warn(`[HEPR] Annotation picking index reached its block budget; fragmented appearances use bounded-memory geometry scans.`))}o(),this.root=Si([...this.entries.values()].map(e=>({bounds:e.bounds,value:e}))),this.prepared=!0}};function Ai(e){let t=e.pdfGeometry.rect,n=e.bounds,r=Math.abs((t[2]-t[0])*(t[3]-t[1])),i=r>0?Math.sqrt(Math.abs((n.maxX-n.minX)*(n.maxY-n.minY))/r):1;return Math.max(0,e.border?.width??1)*i/2}function ji(e,t,n){let r=n.x-t.x,i=n.y-t.y,a=Math.max(0,Math.min(1,((e.x-t.x)*r+(e.y-t.y)*i)/(r*r+i*i||1)));return Math.hypot(e.x-t.x-a*r,e.y-t.y-a*i)}function Mi(e,t){let n=!1;for(let r=0,i=e.length-1;r<e.length;i=r++){let a=e[r],o=e[i];a.y>t.y!=o.y>t.y&&t.x<a.x+(t.y-a.y)*(o.x-a.x)/(o.y-a.y)&&(n=!n)}return n}function Ni(e,t){let n=wi(e.bounds).points.map(t);if(n.some(e=>!e))return 1/0;let r=0;for(let e=0;e<4;e++){let t=n[e],i=n[(e+1)%4];r+=t.x*i.y-t.y*i.x}return Math.abs(r)/2}function Pi(e,t,n,r){let i=1/0;for(let r of Ei(e)){let a=r.points.map(n);if(a.some(e=>!e))continue;let o=a;if(r.filled&&Mi(o,t))return 0;for(let a=0;a<o.length;a++){let s=a+1<o.length?a+1:r.closed?0:a,c=0;if(!r.filled){let t=Ai(e),i=r.points[a],s=o[a];for(let e of[{x:i.x+t,y:i.y},{x:i.x,y:i.y+t}]){let t=n(e);t&&(c=Math.max(c,Math.hypot(t.x-s.x,t.y-s.y)))}}i=Math.min(i,Math.max(0,ji(t,o[a],o[s])-c))}}return i<=r?i:null}function Fi(e,t,n=!1){let r=[],i=0;for(let[a,o]of[e,t].entries()){for(let e of o){let t=n?[wi(e.bounds)]:Ei(e);for(let e of t)for(let t=0;t<e.points.length;t++){let n=e.points[t],i=e.points[t+1]??(e.closed?e.points[0]:n);if(!(t===e.points.length-1&&!e.closed&&e.points.length>1)){if(r.length/8>=262144)throw RangeError(`Annotation metadata highlight exceeds its segment budget.`);r.push(n.x,n.y,i.x,i.y,i.x,i.y,0,-1)}}}a===0&&(i=r.length/8)}return r.length?{segments:Float32Array.from(r),clipPaths:[],selectionCount:i,count:r.length/8}:null}function Ii(e,t,n,r,i,a){let o=[],s=[],c=[],l=[],u=(n,i,a)=>{let c=t.get(n),l=c.annotations.filter(e=>Di(e,r));if(l.length){if(!c.runs.length){for(let e of l)a.push(e);return}for(let t of c.runs)if(yr(e,{kind:t.kind,index:t.first},e=>e===void 0||r.conditions[e]===1))for(let e=t.first;e<t.first+t.count;e++){if(o.length+s.length>=262144)throw RangeError(`Annotation highlight exceeds its primitive budget.`);i.push({kind:t.kind,index:e})}}};try{for(let e of i)u(e,o,c);a!==null&&!i.includes(a)&&u(a,s,l),n.setAnnotationHighlights(o,s,Fi(c,l))}catch(e){if(!(e instanceof RangeError))throw e;console.warn(`[HEPR] Annotation highlight fidelity reduced; using metadata bounds.`,e.message);let o=i.flatMap(e=>t.get(e).annotations.filter(e=>Di(e,r))),s=a!==null&&!i.includes(a)?t.get(a).annotations.filter(e=>Di(e,r)):[];n.setAnnotationHighlights([],[],Fi(o,s,!0))}}async function Li(e,t,n,r,i,a,o,s){let c=r.tolerancePx??4,l=si(r,c),u=await t.query(l,r.signal);s();let d=[],f=a?null:o;for(let t of u)for(let n of t.annotations){if(!Di(n,i))continue;let a=n.pageIndex*4,o=e.pageRects,s=r.point;s.x<o[a]||s.x>o[a+2]||s.y<o[a+1]||s.y>o[a+3]||d.push({entry:t,annotation:n,area:Ni(n,r.project)})}d.sort((e,t)=>e.area-t.area||t.annotation.annotationIndex-e.annotation.annotationIndex||t.annotation.pageIndex-e.annotation.pageIndex||e.annotation.id.localeCompare(t.annotation.id));let p=null,m=1/0,h=performance.now();for(let{entry:e,annotation:a,area:o}of d){if(r.signal?.throwIfAborted(),s(),p&&o>m)break;let u;u=e.runs.length?(await n.pickRanges({...r,isConditionVisible:e=>e===void 0||i.conditions[e]===1},t.appearanceRanges(e,l)))?.distancePx??null:f?.has(a.id)?null:Pi(a,r.clientPoint,r.project,c),u!==null&&(!p||o<m||u<p.distancePx)&&(p={annotationId:a.id,distancePx:u},m=o),performance.now()-h>=8&&(await new Promise(e=>setTimeout(e,0)),h=performance.now())}return r.signal?.throwIfAborted(),s(),p}var Ri=new WeakMap;function zi(e){let t=new Uint8Array;return Ri.set(t,e),t}function Bi(e){return e instanceof Uint8Array?Ri.get(e):void 0}var Vi=[`stroke`,`fill`,`text`,`raster`,`gradient-fill`,`gradient-stroke`],Hi=Vi.length*2;function Ui(e){return{stroke:e.segmentCount,fill:e.fillPathCount,text:e.textInstanceCount,raster:e.rasterLayers.length,"gradient-fill":e.gradientFillPathCount,"gradient-stroke":e.gradientStrokeRunCount}}function Wi(e){let t=e.pagePrimitiveRanges;if(t===void 0)return;let n=e.pageRects.length/4,r=Ui(e);if(!(t instanceof Uint32Array)||t.length!==n*Hi)throw RangeError(`Invalid page primitive ranges.`);Vi.forEach((e,i)=>{let a=0;for(let o=0;o<n;o++){let n=o*Hi+i*2;if(t[n]!==a||t[n+1]>r[e]-a)throw RangeError(`Page primitive ranges overlap, omit, or exceed their store.`);a+=t[n+1]}if(a!==r[e])throw RangeError(`Page primitive ranges do not cover their store.`)})}var Gi=class{pageCount;owners;indices;pageRuns=null;scene;constructor(e){if(this.scene=e,this.pageCount=Math.floor(e.pageRects.length/4),this.pageCount<1)throw RangeError(`The scene has no pages.`);Wi(e);let t=Ui(e);this.owners={},this.indices={};let n=0;for(let[r,i]of Vi.entries()){let a=this.owners[i]=new Uint32Array(t[i]),o=this.indices[i]=Array.from({length:this.pageCount},()=>[]);if(e.pagePrimitiveRanges)for(let t=0;t<this.pageCount;t++){let n=t*Hi+r*2;a.fill(t,e.pagePrimitiveRanges[n],e.pagePrimitiveRanges[n]+e.pagePrimitiveRanges[n+1])}else if(i===`text`)for(let t=0;t<this.pageCount;t++)a.fill(t,e.pageTextRanges[t*2],e.pageTextRanges[t*2]+e.pageTextRanges[t*2+1]);else for(let r=0;r<t[i];r++)if(i===`raster`)a[r]=e.rasterLayers[r].pageIndex??0;else if(i===`gradient-fill`)a[r]=e.gradientFillPaintMeta[r*4+3];else if(i===`gradient-stroke`)a[r]=e.gradientStrokeRunMetaB[r*4+1];else if(this.pageCount>1){let t=r*4,[o,s,c,l]=i===`stroke`?[e.primitiveBounds[t],e.primitiveBounds[t+1],e.primitiveBounds[t+2],e.primitiveBounds[t+3]]:[e.fillPathMetaA[t+2],e.fillPathMetaA[t+3],e.fillPathMetaB[t],e.fillPathMetaB[t+1]],u=a[r]=this.pageAt((o+c)/2,(s+l)/2),d=e.pageRects,f=u*4;o>=Math.min(d[f],d[f+2])&&c<=Math.max(d[f],d[f+2])&&s>=Math.min(d[f+1],d[f+3])&&l<=Math.max(d[f+1],d[f+3])||n++}for(let e=0;e<a.length;e++){if(a[e]>=this.pageCount)throw RangeError(`Primitive references an unknown page.`);o[a[e]].push(e)}}n&&console.warn(`[HEPR] This scene has no exact page primitive ranges, so independent page views infer stroke/fill ownership from the original layout. ${n.toLocaleString()} stroke/fill primitive(s) reach past their nearest page and may be assigned approximately. Exporting the HEP again stores exact ownership.`)}runsOnPage(e,t){if(!this.pageRuns){let e=Array.from({length:this.pageCount},()=>[]);t.forEach((t,n)=>{let r=this.owners[t.kind],i=-1;for(let a=t.first;a<t.first+t.count;a++){let t=r[a];if(t===i)continue;let o=e[t];o[o.length-1]!==n&&o.push(n),i=t}}),this.pageRuns=e}return this.pageRuns[e]}pageAt(e,t){let n=0,r=1/0;for(let i=0;i<this.pageCount;i++){let a=this.scene.pageRects,o=i*4,s=Math.max(Math.min(a[o],a[o+2])-e,0,e-Math.max(a[o],a[o+2])),c=Math.max(Math.min(a[o+1],a[o+3])-t,0,t-Math.max(a[o+1],a[o+3])),l=s*s+c*c;l<r&&(n=i,r=l)}return n}extract(e){if(!Number.isInteger(e)||e<0||e>=this.pageCount)throw RangeError(`Invalid page index.`);let t=this.scene,n=Object.fromEntries(Vi.map(t=>[t,Uint32Array.from(this.indices[t][e])])),r=Object.fromEntries(Vi.map(e=>[e,new Map(Array.from(n[e],(e,t)=>[e,t]))])),i=Object.assign(Object.defineProperties({},Object.getOwnPropertyDescriptors(t)),{pageCount:1,pagesPerRow:1,pageRects:t.pageRects.slice(e*4,e*4+4),pagePrimitiveRanges:void 0,...t.pendingPagePreviews?{pendingPagePreviews:t.pendingPagePreviews.slice(e,e+1)}:{},textIndex:null,retainedPages:void 0,paintGraph:void 0,clipPaths:void 0}),a=i.pageRects;i.pageBounds={minX:Math.min(a[0],a[2]),minY:Math.min(a[1],a[3]),maxX:Math.max(a[0],a[2]),maxY:Math.max(a[1],a[3])},i.bounds={...i.pageBounds};let o=(e,n,r=4)=>{let i=t[e],a=new Float32Array(n.length*r);for(let e=0;e<n.length;e++)a.set(i.subarray(n[e]*r,(n[e]+1)*r),e*r);return a};for(let e of[`endpoints`,`primitiveMeta`,`primitiveBounds`,`styles`])i[e]=o(e,n.stroke);i.segmentCount=i.sourceSegmentCount=i.mergedSegmentCount=n.stroke.length,i.maxHalfWidth=0;for(let e=0;e<i.styles.length;e+=4)i.maxHalfWidth=Math.max(i.maxHalfWidth,i.styles[e]);let s=(e,t,n,r)=>{let a=o(t,e),s=[];for(let t=0;t<e.length;t++){let e=a[t*4],n=a[t*4+1];a[t*4]=s.length;for(let t=0;t<n;t++)s.push(e+t)}return i[t]=a,i[n]=o(n,s),i[r]=o(r,s),s.length};i.fillPathCount=n.fill.length,i.fillSegmentCount=s(n.fill,`fillPathMetaA`,`fillSegmentsA`,`fillSegmentsB`),i.fillPathMetaB=o(`fillPathMetaB`,n.fill),i.fillPathMetaC=o(`fillPathMetaC`,n.fill),i.gradientFillPathCount=n[`gradient-fill`].length,i.gradientFillSegmentCount=s(n[`gradient-fill`],`gradientFillPathMetaA`,`gradientFillSegmentsA`,`gradientFillSegmentsB`);for(let e of[`gradientFillPathMetaB`,`gradientFillPathMetaC`,`gradientFillPaintMeta`])i[e]=o(e,n[`gradient-fill`]);i.gradientStrokeRunCount=n[`gradient-stroke`].length,i.gradientStrokeRunMetaA=o(`gradientStrokeRunMetaA`,n[`gradient-stroke`]),i.gradientStrokeRunMetaB=o(`gradientStrokeRunMetaB`,n[`gradient-stroke`]);let c=[];for(let e=0;e<i.gradientStrokeRunCount;e++){let t=i.gradientStrokeRunMetaA[e*4],n=i.gradientStrokeRunMetaA[e*4+1];i.gradientStrokeRunMetaA[e*4]=c.length,i.gradientStrokeRunMetaB[e*4+1]=0;for(let e=0;e<n;e++)c.push(t+e)}i.gradientStrokeSegmentCount=c.length;for(let e of[`gradientStrokeEndpoints`,`gradientStrokePrimitiveMeta`,`gradientStrokePrimitiveBounds`,`gradientStrokeStyles`])i[e]=o(e,c);let l=[],u=new Map,d=e=>e<0?-1:(u.has(e)||(u.set(e,l.length),l.push(e)),u.get(e));for(let e=0;e<i.gradientFillPaintMeta.length;e+=4)i.gradientFillPaintMeta[e]=d(i.gradientFillPaintMeta[e]),i.gradientFillPaintMeta[e+1]=d(i.gradientFillPaintMeta[e+1]),i.gradientFillPaintMeta[e+3]=0;for(let e=0;e<i.gradientStrokeRunMetaA.length;e+=4)i.gradientStrokeRunMetaA[e+2]=d(i.gradientStrokeRunMetaA[e+2]),i.gradientStrokeRunMetaA[e+3]=d(i.gradientStrokeRunMetaA[e+3]);i.gradientCount=l.length;for(let e of[`gradientMetaA`,`gradientMetaB`,`gradientMetaC`,`gradientMetaD`,`gradientMetaE`])i[e]=o(e,l);let f=t.gradientCount?t.gradientLut.length/t.gradientCount:0;i.gradientLut=new Uint8Array(l.length*f),l.forEach((e,n)=>i.gradientLut.set(t.gradientLut.subarray(e*f,(e+1)*f),n*f)),Ki(t,i,l),i.textInstanceCount=i.sourceTextCount=i.textInPageCount=n.text.length,i.textOutOfPageCount=0;let p=e=>{let r=n.text,i=t[e],a=r[0]??0,s=a+r.length;return(!r.length||r[r.length-1]===s-1)&&s*4<=i.length?i.subarray(a*4,s*4):o(e,r)};i.textInstanceA=p(`textInstanceA`),i.textInstanceB=p(`textInstanceB`),i.textInstanceC=p(`textInstanceC`);let m=[],h=new Map;for(let e=0;e<i.textInstanceB.length;e+=4){let n=i.textInstanceB[e+3]-1;n>=0&&(i.textInstanceB.buffer===t.textInstanceB.buffer&&(i.textInstanceB=i.textInstanceB.slice()),h.has(n)||(h.set(n,m.length),m.push(n)),i.textInstanceB[e+3]=h.get(n)+1)}i.textClipRects=m.length?o(`textClipRects`,m):void 0,i.pageTextRanges=Uint32Array.of(0,i.textInstanceCount);let g=t.textIndex?.pages[e];g&&(i.textIndex={version:2,pages:[{...g,charInstance:Int32Array.from(g.charInstance,e=>e<0?e:r.text.get(e)??-1)}]}),i.textContent=t.textContent?.filter(t=>t.pageIndex===e).map(e=>({...e,pageIndex:0})),i.annotations=t.annotations?.filter(t=>t.pageIndex===e).map(e=>({...e,pageIndex:0})),i.pdfPages=t.pdfPages?.filter(t=>t.pageIndex===e).map(e=>({...e,pageIndex:0}));let _=b(t,n);_?i.markedContent=_:delete i.markedContent,i.rasterLayers=Array.from(n.raster,e=>ge(t.rasterLayers[e],{pageIndex:0}));let v=i.rasterLayers[0],y=new Uint8Array;i.rasterLayerWidth=v?.width??0,i.rasterLayerHeight=v?.height??0,Object.defineProperty(i,"rasterLayerData",{enumerable:!0,configurable:!0,get:()=>v?.data??y}),i.rasterLayerMatrix=v?.matrix??Float32Array.of(1,0,0,1,0,0),i.imagePaintOpCount=i.rasterLayers.reduce((e,t)=>e+(t.repeat?N(t.repeat):1),0);let S=t.drawRuns??x(t),C=new Map;i.drawRuns=[];let w=new Map;i.clipPaths=[];let E=e=>{if(w.has(e))return w.get(e);let n=t.clipPaths[e],r=n.parent<0?-1:E(n.parent),a=i.clipPaths.length;return w.set(e,a),i.clipPaths.push({...n,parent:r}),a};for(let t of this.runsOnPage(e,S)){let e=S[t],r=n[e.kind],a=qi(r,e.first),o=qi(r,e.first+e.count);if(a===o)continue;let s={...e,first:a,count:o-a,...e.clipIndex===void 0?{}:{clipIndex:E(e.clipIndex)}};C.set(t,[i.drawRuns.length]),i.drawRuns.push(s)}let D=new Map,O=e=>e.flatMap(e=>{if(e.kind===`draw`)return(C.get(e.runIndex)??[]).map(t=>({...e,runIndex:t}));if(e.kind===`retained`){let n=r.raster.get(e.rasterIndex);return n===void 0?[]:(i.retainedPages??=[],D.has(e.retainedPage)||(D.set(e.retainedPage,i.retainedPages.length),i.retainedPages.push(t.retainedPages[e.retainedPage])),[{...e,rasterIndex:n,retainedPage:D.get(e.retainedPage)}])}let n=O(e.children);return n.length?[{...e,children:n,...e.softMask?{softMask:{...e.softMask,children:O(e.softMask.children)}}:{}}]:[]});t.paintGraph&&(i.paintGraph={roots:O(t.paintGraph.roots)});let k={minX:1/0,minY:1/0,maxX:-1/0,maxY:-1/0},A=e=>{k.minX=Math.min(k.minX,e.minX),k.minY=Math.min(k.minY,e.minY),k.maxX=Math.max(k.maxX,e.maxX),k.maxY=Math.max(k.maxY,e.maxY),i.bounds.minX=Math.min(i.bounds.minX,e.minX),i.bounds.minY=Math.min(i.bounds.minY,e.minY),i.bounds.maxX=Math.max(i.bounds.maxX,e.maxX),i.bounds.maxY=Math.max(i.bounds.maxY,e.maxY)},j=new ee(i),M=[0,0,0,0];for(let e=0;e<i.drawRuns.length;e++){let t=i.drawRuns[e].kind;t!==`gradient-fill`&&t!==`gradient-stroke`&&(j.getBounds(e,0,M),M.every(Number.isFinite)&&M[0]<=M[2]&&M[1]<=M[3]&&A({minX:M[0],minY:M[1],maxX:M[2],maxY:M[3]}))}for(let e=0;e<i.gradientFillPathCount*4;e+=4)A({minX:i.gradientFillPathMetaA[e+2],minY:i.gradientFillPathMetaA[e+3],maxX:i.gradientFillPathMetaB[e],maxY:i.gradientFillPathMetaB[e+1]});for(let e=0;e<i.gradientStrokeSegmentCount*4;e+=4){let t=i.gradientStrokeEndpoints,n=i.gradientStrokePrimitiveMeta,r=Math.SQRT2*Math.max(0,i.gradientStrokeStyles[e]);A({minX:Math.min(t[e],t[e+2],n[e])-r,minY:Math.min(t[e+1],t[e+3],n[e+1])-r,maxX:Math.max(t[e],t[e+2],n[e])+r,maxY:Math.max(t[e+1],t[e+3],n[e+1])+r})}i.pathCount=i.fillPathCount+i.gradientFillPathCount,i.pagePrimitiveRanges=Uint32Array.from(Vi.flatMap(e=>[0,n[e].length]));for(let e of i.drawRuns??[])e.pdfRepresentation&&={...e.pdfRepresentation,pageIndex:0};return T(i),ie(i),{scene:i,paintBounds:k,primitives:n,pageIndex:e}}localRef(e,t){let n=e.primitives[t.kind],r=0,i=n.length;for(;r<i;){let e=r+i>>>1;n[e]<t.index?r=e+1:i=e}return n[r]===t.index?{kind:t.kind,index:r}:null}};function Ki(e,t,n){if(t.gradientMeshRanges=void 0,t.gradientMeshPositions=void 0,t.gradientMeshColors=void 0,t.gradientMeshIndices=void 0,!e.gradientMeshRanges||!e.gradientMeshIndices)return;let r=new Uint32Array(n.length*2),i=[],a=[],o=[],s=new Map;n.forEach((t,n)=>{let c=e.gradientMeshRanges[t*2],l=e.gradientMeshRanges[t*2+1];r[n*2]=o.length,r[n*2+1]=l;for(let t=c;t<c+l;t++){let n=e.gradientMeshIndices[t];s.has(n)||(s.set(n,s.size),i.push(...e.gradientMeshPositions.subarray(n*2,n*2+2)),a.push(...e.gradientMeshColors.subarray(n*4,n*4+4))),o.push(s.get(n))}}),t.gradientMeshRanges=r,t.gradientMeshPositions=Float32Array.from(i),t.gradientMeshColors=Float32Array.from(a),t.gradientMeshIndices=Uint32Array.from(o)}function qi(e,t){let n=0,r=e.length;for(;n<r;){let i=n+r>>>1;e[i]<t?n=i+1:r=i}return n}function Ji(){return{pageCount:0,pagesPerRow:1,pageRects:new Float32Array,pageTextRanges:new Uint32Array,textIndex:null,fillPathCount:0,fillSegmentCount:0,fillPathMetaA:new Float32Array,fillPathMetaB:new Float32Array,fillPathMetaC:new Float32Array,fillSegmentsA:new Float32Array,fillSegmentsB:new Float32Array,gradientCount:0,gradientMetaA:new Float32Array,gradientMetaB:new Float32Array,gradientMetaC:new Float32Array,gradientMetaD:new Float32Array,gradientMetaE:new Float32Array,gradientLut:new Uint8Array,gradientFillPathCount:0,gradientFillSegmentCount:0,gradientFillPathMetaA:new Float32Array,gradientFillPathMetaB:new Float32Array,gradientFillPathMetaC:new Float32Array,gradientFillPaintMeta:new Float32Array,gradientFillSegmentsA:new Float32Array,gradientFillSegmentsB:new Float32Array,gradientStrokeRunCount:0,gradientStrokeSegmentCount:0,gradientStrokeRunMetaA:new Float32Array,gradientStrokeRunMetaB:new Float32Array,gradientStrokeEndpoints:new Float32Array,gradientStrokePrimitiveMeta:new Float32Array,gradientStrokePrimitiveBounds:new Float32Array,gradientStrokeStyles:new Float32Array,segmentCount:0,sourceSegmentCount:0,mergedSegmentCount:0,sourceTextCount:0,textInstanceCount:0,textGlyphCount:0,textGlyphSegmentCount:0,textInPageCount:0,textOutOfPageCount:0,textInstanceA:new Float32Array,textInstanceB:new Float32Array,textInstanceC:new Float32Array,textGlyphMetaA:new Float32Array,textGlyphMetaB:new Float32Array,textGlyphSegmentsA:new Float32Array,textGlyphSegmentsB:new Float32Array,rasterLayers:[],rasterLayerWidth:0,rasterLayerHeight:0,rasterLayerData:new Uint8Array,rasterLayerMatrix:new Float32Array([1,0,0,1,0,0]),endpoints:new Float32Array,primitiveMeta:new Float32Array,primitiveBounds:new Float32Array,styles:new Float32Array,bounds:{minX:0,minY:0,maxX:1,maxY:1},pageBounds:{minX:0,minY:0,maxX:1,maxY:1},maxHalfWidth:0,imagePaintOpCount:0,pathCount:0,discardedTransparentCount:0,discardedDegenerateCount:0,discardedDuplicateCount:0,discardedContainedCount:0}}var Yi=class e{enabled;root;start;end;fixedMeta;constructor(e,t={}){this.root=t.root??{callback:e,throttleMs:t.throttleMs??80,minDelta:t.minDelta??.002,lastEmittedValue:-1,lastEmittedAt:0},this.start=Qi(t.start??0),this.end=Qi(t.end??1),this.fixedMeta=t.fixedMeta??{},this.enabled=typeof this.root.callback==`function`}child(t,n,r={}){let i=ea(this.start,this.end,Qi(t)),a=ea(this.start,this.end,Qi(n));return new e(void 0,{start:i,end:a,root:this.root,fixedMeta:{...this.fixedMeta,...r}})}toCallback(){return e=>{this.report(e.value,e)}}report(e,t={}){if(!this.enabled)return;let n={...this.fixedMeta,...t},r=Qi(e),i=ea(this.start,this.end,r),a=Math.max(this.root.lastEmittedValue,i),o=n.stage??this.fixedMeta.stage??this.root.lastStage??`source`,s=ta(),c=a-this.root.lastEmittedValue,l=o!==this.root.lastStage;if(!(this.root.lastEmittedValue<0||a>=1||l||c>=this.root.minDelta||s-this.root.lastEmittedAt>=this.root.throttleMs))return;let u={value:Qi(a),stage:o,executionPath:n.executionPath,sourceType:n.sourceType,unit:n.unit,processed:n.processed,total:n.total,pageIndex:n.pageIndex,pageCount:n.pageCount,sourcePageIndex:n.sourcePageIndex,sourcePageCount:n.sourcePageCount};this.root.lastEmittedValue=u.value,this.root.lastEmittedAt=s,this.root.lastStage=u.stage,this.root.callback?.(u)}complete(e={}){this.report(1,{stage:`complete`,...e})}async withIndeterminateProgress(e,t){if(!this.enabled)return typeof e==`function`?e():e;let n=Math.max(50,Math.trunc(t.tickMs??90)),r=$i(t.ceiling??.9,.1,.999),i=Math.max(1,Number.isFinite(t.timeConstantMs)?t.timeConstantMs:800),a=ta(),o={stage:t.stage,executionPath:t.executionPath,sourceType:t.sourceType,unit:t.unit,processed:t.processed,total:t.total,pageIndex:t.pageIndex,pageCount:t.pageCount,sourcePageIndex:t.sourcePageIndex,sourcePageCount:t.sourcePageCount};this.report(0,o);let s=globalThis.setInterval(()=>{let e=Math.max(0,ta()-a)/i;this.report(Math.min(r,r*(1-1/(1+e))),o)},n);try{let t=await(typeof e==`function`?e():e);return this.report(1,o),t}finally{globalThis.clearInterval(s)}}};function Xi(e,t={}){return new Yi(e,t)}function Zi(e){switch(e){case`source`:return`Reading source`;case`pdf-page`:return`Processing pages`;case`pdf-operators`:return`Scanning operators`;case`pdf-optimize`:return`Optimizing geometry`;case`pdf-text`:return`Extracting text`;case`pdf-raster`:return`Extracting rasters`;case`compile`:return`Compiling`;case`hep-open`:return`Opening HEP`;case`hep-manifest`:return`Reading manifest`;case`hep-section`:return`Decoding HEP`;case`raster-encode`:return`Preparing raster data`;case`hep-build`:return`Building HEP`;case`vector-lod`:return`Building Vector LOD`;case`vector-lod-restore`:return`Loading Vector LOD`;case`text-lod`:return`Building Text LOD`;case`upload`:return`Uploading`;case`first-render`:return`Rendering first frame`;case`complete`:return`Complete`;default:return`Parsing / loading`}}function Qi(e){return $i(e,0,1)}function $i(e,t,n){return!Number.isFinite(e)||e<t?t:e>n?n:e}function ea(e,t,n){return e+(t-e)*n}function ta(){return typeof performance<`u`&&typeof performance.now==`function`?performance.now():Date.now()}function na(e){if(e!==void 0&&e!==`qcms`&&e!==`lcms`&&e!==`alternate`&&e!==`none`)throw TypeError(`iccEngine must be "qcms", "lcms", "alternate", or "none".`);return e??`qcms`}function ra(e,t,n){return e.map((e,r)=>{let i=t[r*2],a=t[r*2+1],o=Math.max(i,Math.min(a,e));return n===2?a===i?0:(o-i)/(a-i):n===4?r===0?o/100:(o+128)/255:o})}var ia=Object.freeze({1:256,3:33,4:17}),aa=2**53-1;function oa(e,t,n,r=aa,i){I(i);let a=ia[n],o=pa(n,a,r),s,c;try{s=new Uint8Array(e.byteLength),s.set(e),c=new Uint8Array(o.inputBytes)}catch(t){throw new oe(`resource-limit`,`Unable to allocate an ICC transform request.`,{cause:t,details:{profileBytes:e.byteLength,inputBytes:o.inputBytes}})}for(let e=0;e<o.sampleCount;e+=1){e&4095||I(i);let t=e,r=e*n;for(let e=n-1;e>=0;--e){let n=t%a;t=Math.floor(t/a),c[r+e]=Math.round(n*255/(a-1))}}return I(i),Object.freeze({profile:s,metadata:Object.freeze({...t}),inputComponents:n,gridPointsPerComponent:a,sampleCount:o.sampleCount,inputSamples:c,renderingIntent:`relative-colorimetric`})}async function sa(e,t,n=aa,r){ca(t,n),I(r);let i;try{i=await e(t,r)}catch(e){throw I(r),e instanceof oe?e:new oe(`unsupported-color`,`The ICC transform resolver failed.`,{cause:e,details:{reason:`icc-transform-resolver-failed`}})}return I(r),la(i,t,n,r)}function ca(e,t=aa){if(!e||typeof e!=`object`||!(e.profile instanceof Uint8Array)||!(e.inputSamples instanceof Uint8Array)||!ha(e.inputComponents)||e.renderingIntent!==`relative-colorimetric`||!e.metadata||typeof e.metadata!=`object`)throw ma(`The ICC transform request is malformed.`);let n=pa(e.inputComponents,e.gridPointsPerComponent,t);if(e.sampleCount!==n.sampleCount||e.inputSamples.byteLength!==n.inputBytes)throw ma(`The ICC transform request has an inconsistent sample layout.`,{expectedSamples:n.sampleCount,actualSamples:e.sampleCount,expectedBytes:n.inputBytes,actualBytes:e.inputSamples.byteLength});if(!Number.isSafeInteger(e.metadata.declaredSize)||e.metadata.declaredSize!==e.profile.byteLength||!Number.isSafeInteger(e.metadata.versionMajor)||e.metadata.versionMajor<0||e.metadata.versionMajor>255||!ga(e.metadata.preferredCmm)||!ga(e.metadata.deviceClass)||!ga(e.metadata.dataColorSpace)||!ga(e.metadata.connectionSpace))throw ma(`The ICC transform request has invalid profile metadata.`)}function la(e,t,n=aa,r){I(r);let i=pa(t.inputComponents,t.gridPointsPerComponent,n);if(!e||typeof e!=`object`||!(e.samples instanceof Uint8Array)||e.sampleCount!==i.sampleCount||e.outputComponents!==3||e.bitsPerComponent!==8||e.samples.byteLength!==i.outputBytes)throw ma(`The ICC transform resolver returned an invalid result.`,{expectedSamples:i.sampleCount,actualSamples:_a(e?.sampleCount),expectedBytes:i.outputBytes,actualBytes:e?.samples instanceof Uint8Array?e.samples.byteLength:-1},`invalid-icc-transform-result`);let a;try{a=new Uint8Array(e.samples.byteLength),a.set(e.samples)}catch(e){throw new oe(`resource-limit`,`Unable to copy the ICC transform result.`,{cause:e,details:{bytes:i.outputBytes}})}return I(r),Object.freeze({samples:a,sampleCount:i.sampleCount,outputComponents:3,bitsPerComponent:8})}function ua(e,t,n,r){if(I(r),n.length!==t||n.some(e=>!Number.isFinite(e)))throw new oe(`unsupported-color`,`The ICC transform received an invalid component vector.`);let i=ia[t],a=Math.max(0,Math.min(1,n[0]))*(i-1),o=Math.floor(a),s=Math.min(o+1,i-1),c=a-o;if(t===1){let t=o*3,n=s*3;return[(e.samples[t]*(1-c)+e.samples[n]*c)/255,(e.samples[t+1]*(1-c)+e.samples[n+1]*c)/255,(e.samples[t+2]*(1-c)+e.samples[n+2]*c)/255]}let l=Math.max(0,Math.min(1,n[1]))*(i-1),u=Math.floor(l),d=Math.min(u+1,i-1),f=l-u,p=Math.max(0,Math.min(1,n[2]))*(i-1),m=Math.floor(p),h=Math.min(m+1,i-1),g=p-m,_=0,v=0,y=0;if(t===4){let e=Math.max(0,Math.min(1,n[3]))*(i-1);_=Math.floor(e),v=Math.min(_+1,i-1),y=e-_}let b=0,x=0,S=0,C=1<<t;for(let n=0;n<C;n+=1){let r=!!(n&1),a=!!(n&2),l=!!(n&4),p=r?s:o,C=a?d:u,w=l?h:m,T=(p*i+C)*i+w,E=(r?c:1-c)*(a?f:1-f)*(l?g:1-g);if(t===4){let e=!!(n&8);T=T*i+(e?v:_),E*=e?y:1-y}if(E===0)continue;let D=T*3;b+=e.samples[D]*E,x+=e.samples[D+1]*E,S+=e.samples[D+2]*E}return I(r),[b/255,x/255,S/255]}function da(e,t,n,r,i){if(n.length!==t)return null;let a=ia[t],o=e.samples,s=0,c=0,l=0,u=0,d=0,f=0,p=0,m=0,h=0,g=0,_=0,v=0;for(let e=0;e<t;e+=1){let t=r[e*2],o=r[e*2+1],y=Math.max(t,Math.min(o,n[e])),b=i===2?o===t?0:(y-t)/(o-t):i===4?e===0?y/100:(y+128)/255:y;if(!Number.isFinite(b))return null;let x=Math.max(0,Math.min(1,b))*(a-1),S=Math.floor(x),C=Math.min(S+1,a-1),w=x-S;e===0?(s=S,c=C,l=w):e===1?(u=S,d=C,f=w):e===2?(p=S,m=C,h=w):(g=S,_=C,v=w)}if(t===1){let e=s*3,t=c*3;return[(o[e]*(1-l)+o[t]*l)/255,(o[e+1]*(1-l)+o[t+1]*l)/255,(o[e+2]*(1-l)+o[t+2]*l)/255]}let y=1-l,b=1-f,x=1-h,S=1-v,C=y*b,w=l*b,T=y*f,E=l*f,D=s*a+u,O=c*a+u,k=s*a+d,A=c*a+d,j=0,M=0,N=0;for(let e=0;e<1<<t;e+=1){let n=e&3,r=(n===0?C:n===1?w:n===2?T:E)*(e&4?h:x),i=(n===0?D:n===1?O:n===2?k:A)*a+(e&4?m:p);if(t===4){let t=!!(e&8);i=i*a+(t?_:g),r*=t?v:S}if(r===0)continue;let s=i*3;j+=o[s]*r,M+=o[s+1]*r,N+=o[s+2]*r}return[j/255,M/255,N/255]}function fa(e,t,n,r,i){let a=ia[t],o=new Int32Array(t*256),s=new Int32Array(t*256),c=new Float64Array(t*256),l=new Float64Array(t*256);for(let e=0;e<t;e+=1){let t=r[e*2],u=r[e*2+1];for(let r=0;r<256;r+=1){let d=n[e*256+r];if(!Number.isFinite(d))return null;let f=Math.max(t,Math.min(u,d)),p=i===2?u===t?0:(f-t)/(u-t):i===4?e===0?f/100:(f+128)/255:f;if(!Number.isFinite(p))return null;let m=Math.max(0,Math.min(1,p))*(a-1),h=e*256+r;o[h]=Math.floor(m),s[h]=Math.min(o[h]+1,a-1),c[h]=m-o[h],l[h]=1-c[h]}}let u=e.samples,d=t===4,f=d?16:8,p=new Float64Array(16),m=new Int32Array(16);return(e,t,n)=>{let r=e[t],i=256+e[t+1],h=512+e[t+2],g=c[r],_=l[r],v=c[i],y=l[i],b=c[h],x=l[h],S=o[h],C=s[h],w=_*y,T=g*y,E=_*v,D=g*v,O=o[r]*a+o[i],k=s[r]*a+o[i],A=o[r]*a+s[i],j=s[r]*a+s[i];if(p[0]=w*x,p[1]=T*x,p[2]=E*x,p[3]=D*x,p[4]=w*b,p[5]=T*b,p[6]=E*b,p[7]=D*b,m[0]=O*a+S,m[1]=k*a+S,m[2]=A*a+S,m[3]=j*a+S,m[4]=O*a+C,m[5]=k*a+C,m[6]=A*a+C,m[7]=j*a+C,d){let n=768+e[t+3],r=c[n],i=l[n],u=o[n],d=s[n];for(let e=7;e>=0;--e)p[e+8]=p[e]*r,p[e]*=i,m[e+8]=(m[e]*a+d)*3,m[e]=(m[e]*a+u)*3}else for(let e=0;e<8;e+=1)m[e]*=3;let M=0,N=0,P=0;for(let e=0;e<f;e+=1){let t=p[e],n=m[e];M+=u[n]*t,N+=u[n+1]*t,P+=u[n+2]*t}return n[0]=M/255,n[1]=N/255,n[2]=P/255,Number.isFinite(n[0])&&Number.isFinite(n[1])&&Number.isFinite(n[2])}}function pa(e,t,n){if(!ha(e))throw ma(`The ICC transform component count is unsupported.`);if(!Number.isSafeInteger(t)||t<2||t>256)throw ma(`The ICC transform grid size is invalid.`);if(!Number.isSafeInteger(n)||n<=0)throw RangeError(`maxIccTransformBytes must be a positive safe integer.`);let r=1;for(let n=0;n<e;n+=1)if(r*=t,!Number.isSafeInteger(r))throw new oe(`resource-limit`,`The ICC transform sample count is too large.`);let i=r*e,a=r*3,o=i+a;if(!Number.isSafeInteger(i)||!Number.isSafeInteger(a)||!Number.isSafeInteger(o)||o>n)throw new oe(`resource-limit`,`An ICC transform exceeds the configured byte limit.`,{details:{workingBytes:o,limit:n,reason:`icc-transform-bytes`}});return{sampleCount:r,inputBytes:i,outputBytes:a}}function ma(e,t={},n=`invalid-icc-transform-request`){return new oe(`unsupported-color`,e,{details:{reason:n,...t}})}function ha(e){return e===1||e===3||e===4}function ga(e){return typeof e==`string`&&e.length===4}function _a(e){return typeof e==`number`&&Number.isSafeInteger(e)?e:-1}function va(e,t){let n=e=>e.map(e=>{let r=e.optionalContent===void 0?{}:{optionalContent:e.optionalContent+t.condition};return e.kind===`draw`?{...e,...r,runIndex:e.runIndex+t.run}:e.kind===`retained`?{...e,...r,retainedPage:e.retainedPage+t.retainedPage,rasterIndex:e.rasterIndex+t.raster}:{...e,...r,children:n(e.children),...e.bounds?{bounds:{minX:e.bounds.minX+t.x,minY:e.bounds.minY+t.y,maxX:e.bounds.maxX+t.x,maxY:e.bounds.maxY+t.y}}:{},...e.softMask?{softMask:{...e.softMask,children:n(e.softMask.children),...e.softMask.transfer?{transfer:e.softMask.transfer.slice()}:{},...e.softMask.backdrop?{backdrop:[...e.softMask.backdrop]}:{}}}:{}}});return{roots:n(e.roots)}}function ya(e){let t=new Map,n=new Set;for(let t of e)for(let e of t?.groups??[])e.annotationId===void 0&&n.add(e.id);let r=s-n.size,i=0,a=[],o=[],c=[],l=new Set,u=new Map,d=e=>{let t=[...e];for(;t.length;){let e=t.pop();if(e.kind===`group`&&l.add(e.groupId),e.children)for(let n of e.children)t.push(n)}};for(let n of e){let e=a.length;if(o.push(e),!n)continue;let s=new Set;for(let e of n.groups)if(!t.has(e.id)){if(e.annotationId!==void 0&&r<=0){s.add(e.id),i++;continue}e.annotationId!==void 0&&r--,t.set(e.id,e)}for(let t of n.conditions)a.push(t.kind===`and`||t.kind===`or`?{kind:t.kind,operands:t.operands.map(t=>t+e)}:t.kind===`not`?{kind:`not`,operand:t.operand+e}:t.kind===`group`&&s.has(t.groupId)?{kind:`constant`,value:!0}:{...t});if(!c.length){for(let e of n.order)c.push(e);d(n.order)}for(let e of n.radioGroups)u.set(JSON.stringify(e),[...e])}for(let e of t.values())!l.has(e.id)&&e.annotationId===void 0&&c.push({kind:`group`,groupId:e.id});return{data:t.size?{groups:[...t.values()],conditions:a,order:c,radioGroups:[...u.values()]}:void 0,offsets:o,droppedAnnotationLayers:i}}var ba=[37,80,68,70,45],xa=1024;function Sa(e){let t=Math.min(e.length,xa)-ba.length;for(let n=0;n<=t;n+=1){let t=!0;for(let r=0;r<ba.length;r+=1)if(e[n+r]!==ba[r]){t=!1;break}if(t)return!0}return!1}function Ca(e,t={}){if(Sa(e))return;let n=t.label?.trim()||`PDF source`,r=wa(t.contentType);if(r===`text/html`||Ta(e))throw Error(`Expected PDF data for ${n}, but received HTML instead. The asset URL may have resolved to an application fallback page.`);let i=r?` (content type ${r})`:``;throw Error(`Expected PDF data for ${n}, but no %PDF- header was found in the first ${xa.toLocaleString(`en-US`)} bytes${i}.`)}function wa(e){return e?.split(`;`,1)[0]?.trim().toLowerCase()||null}function Ta(e){let t=Math.min(e.length,128),n=``;for(let r=0;r<t;r+=1)n+=String.fromCharCode(e[r]);let r=n.replace(/^\uFEFF/,``).trimStart().toLowerCase();return r.startsWith(`<!doctype html`)||r.startsWith(`<html`)}function Ea(e){let t=e.compressScans,n=e.pageLoading;return t&&e.ocrTextOnly?(Da(e,{code:ve.CompressScansOcrConflict,severity:`warning`,message:`compressScans: true conflicts with ocrTextOnly: true. Scan preparation is disabled because OCR-only viewing skips images; the requested pageLoading mode is retained.`,details:{ignoredOption:`compressScans`,requestedValue:!0,effectiveValue:!1,overridingOption:`ocrTextOnly`}}),t=!1):t&&n===`auto`&&(Da(e,{code:ve.CompressScansStreamingConflict,severity:`warning`,message:`pageLoading: "auto" conflicts with compressScans: true. Scan preparation loads all selected pages upfront, so page streaming is disabled and pageLoading uses "eager".`,details:{ignoredOption:`pageLoading`,requestedValue:`auto`,effectiveValue:`eager`,overridingOption:`compressScans`}}),n=`eager`),{compressScans:t,pageLoading:n}}function Da(e,t){console.warn(`[HEPR] ${t.message}`,t.details),e.onDiagnostic?.(t)}var Oa=Le({GRADIENT_LUT_WIDTH:()=>Aa,STROKE_STYLE_FLAG_HAIRLINE:()=>1,composeOverlappingVectorScenes:()=>Qa,composeVectorScenesInColumn:()=>Za,composeVectorScenesInGrid:()=>Xa,decodeStrokeStyleMeta:()=>Fa,deriveSceneTextContentFromIndex:()=>qa,extractPdfPageScenes:()=>Ia,inferPageTextRanges:()=>ro,nativeVectorMissingFontResolver:()=>Va,optimizeVectorSceneTextGlyphs:()=>no,reportNativePdfProgress:()=>Wa,resolvePdfPageNumbers:()=>bo}),ka=class{data;length=0;constructor(e=32768){this.data=new Float32Array(e*4)}get quadCount(){return this.length>>2}truncateQuads(e){this.length=Math.max(0,Math.min(this.length,Math.trunc(e)*4))}push(e,t,n,r){this.ensureCapacity(4);let i=this.length;this.data[i]=e,this.data[i+1]=t,this.data[i+2]=n,this.data[i+3]=r,this.length+=4}append(e,t,n){n<=0||(this.ensureCapacity(n),this.data.set(e.subarray(t,t+n),this.length),this.length+=n)}toTypedArray(){return this.data.slice(0,this.length)}ensureCapacity(e){if(this.length+e<=this.data.length)return;let t=this.data.length;for(;this.length+e>t;)t*=2;let n=new Float32Array(t);n.set(this.data),this.data=n}},Aa=1024,ja=2,Ma=.08,Na=24,Pa=.94;function Fa(e){let t=Math.max(0,Math.trunc(e/ja+1e-6));return{alpha:So(e-t*ja),styleFlags:t}}async function Ia(e,t={},n,r=`copy`,i){return n?.throwIfAborted(),na(t.iccEngine),Ya(e),Ra(e,t,Xi(t.onProgress),0,n,r,i)}function La(e,t,n,r,i){let a=t.child(n,r);return{...e,onProgress:e=>{a.report(e.value,{...e,executionPath:i})}}}async function Ra(e,t,n,r,i,a=`copy`,o){let s=await za(e,La(t,n,r,Pa,`worker`),i,a,o);return n.report(Pa,{stage:`compile`,executionPath:`worker`,sourceType:`pdf`,unit:`pages`,processed:s.length,total:s.length,pageCount:s.length}),s}async function za(t,n,r,i=`copy`,a){r?.throwIfAborted(),n={...n,compressScans:Ea(n).compressScans};let{openPdfInBrowserWorker:o,openPdfInNodeWorker:s}=await e(async()=>{let{openPdfInBrowserWorker:e,openPdfInNodeWorker:t}=await import(`./workerClient-COglgcVC.js`);return{openPdfInBrowserWorker:e,openPdfInNodeWorker:t}},__vite__mapDeps([0,1,2,3,4]),import.meta.url);r?.throwIfAborted();let c=Xi(n.onProgress);c.report(0,{stage:`source`,executionPath:`worker`,sourceType:`pdf`,unit:`bytes`,processed:0,total:t.byteLength});let l=-1,u=0,d=0,f=e=>{Wa(c,e,{selectionIndex:l,selectedPageCount:u,sourcePageCount:d})},p=null,m,h=!1;try{let h={kind:`bytes`,bytes:new Uint8Array(t),ownership:i},g=await Va(),_={repair:`safe`,password:n.password,imageCodecResolver:n.imageCodecResolver,signal:r,missingFontResolver:g,iccTransformResolver:n.iccTransformResolver,iccEngine:n.iccEngine,embeddedFontPaint:n.embeddedFontPaint,onDiagnostic:n.onDiagnostic,onProgress:f};p=Ha()?await s(h,_):await o(h,_);let v=Ua(p);d=v.info.pageCount;let y=bo(d,n.pages);if(u=y.length,n.compressScans&&!n.ocrTextOnly){let{createPdfRasterCompressor:t}=await e(async()=>{let{createPdfRasterCompressor:e}=await import(`./pdfRasterCompression-CdTxQZEN.js`);return{createPdfRasterCompressor:e}},__vite__mapDeps([5,3,4,6]),import.meta.url);m=t(n.onDiagnostic)}let b=[],x;for(l=0;l<u;l+=1){r?.throwIfAborted();let e=y[l]-1,t=.12+l/u*.82,i=.12+(l+1)/u*.82;c.report(t,{stage:`pdf-page`,executionPath:`worker`,sourceType:`pdf`,unit:`pages`,processed:l,total:u,pageIndex:l,pageCount:u,sourcePageIndex:e,sourcePageCount:d});let o=await v.compileVectorPage(e,{ocrTextOnly:n.ocrTextOnly,signal:r,optimization:n.enableSegmentMerge===!1&&n.enableInvisibleCull===!1?`none`:`safe`,enableSegmentMerge:n.enableSegmentMerge!==!1,enableInvisibleCull:n.enableInvisibleCull!==!1,...n.annotationAppearances?{annotationAppearances:n.annotationAppearances}:{},onProgress:f});r?.throwIfAborted(),n.extractTextContent===!0&&(o.textContent=qa(o,0)),await m?.preparePage(o,u,e,r),r?.throwIfAborted(),a&&(l+1===u&&(await v.close(),p=null,r?.throwIfAborted()),await x,x=a(o,r),x.catch(()=>void 0)),b.push(o),c.report(i,{stage:`pdf-page`,executionPath:`worker`,sourceType:`pdf`,unit:`pages`,processed:l+1,total:u,pageIndex:l,pageCount:u,sourcePageIndex:e,sourcePageCount:d})}return await x,r?.throwIfAborted(),c.report(1,{stage:`compile`,executionPath:`worker`,sourceType:`pdf`,unit:`pages`,processed:b.length,total:b.length,pageCount:b.length,sourcePageCount:d}),b}catch(e){throw h=!0,e}finally{m?.dispose();try{await p?.close()}catch(e){if(!h)throw e}}}var Ba;function Va(){return Ba??=Ha()?e(async()=>{let{createNodeBundledStandardFontResolver:e}=await import(`./nodePdfSource-2kKniSRe.js`);return{createNodeBundledStandardFontResolver:e}},__vite__mapDeps([7,1,8,9]),import.meta.url).then(({createNodeBundledStandardFontResolver:e})=>e()):e(async()=>{let{createBundledStandardFontResolver:e}=await import(`./standardFontResolver-d7UgpWo-.js`);return{createBundledStandardFontResolver:e}},__vite__mapDeps([8,9]),import.meta.url).then(({createBundledStandardFontResolver:e})=>e()),Ba}function Ha(){return typeof globalThis.process?.versions?.node==`string`}function Ua(e){if(typeof e.compileVectorPage!=`function`)throw TypeError(`The native PDF session does not expose VectorScene compilation.`);return e}function Wa(e,t,n){let r=Ga(t.stage),i=n.selectionIndex>=0&&n.selectedPageCount>0,a=t.total&&t.total>0?Math.max(0,Math.min(1,t.completed/t.total)):0,o;o=i?.12+n.selectionIndex/n.selectedPageCount*.82+.82/n.selectedPageCount*(t.stage===`content`?.08+a*.56:t.stage===`optimize`?.66+a*.24:t.stage===`font`?.92:t.stage===`image`||t.stage===`color`?.96:.04):t.stage===`source-read`?.02*a:t.stage===`xref`?.05:t.stage===`catalog`?.09:.11,e.report(o,{stage:r,executionPath:`worker`,sourceType:`pdf`,unit:Ka(t.stage),processed:t.completed,...t.total===null?{}:{total:t.total},...i?{pageIndex:n.selectionIndex,pageCount:n.selectedPageCount}:{},...t.sourcePageIndex===null?{}:{sourcePageIndex:t.sourcePageIndex},...n.sourcePageCount>0?{sourcePageCount:n.sourcePageCount}:{}})}function Ga(e){switch(e){case`source-read`:case`xref`:case`catalog`:return`source`;case`page`:return`pdf-page`;case`content`:return`pdf-operators`;case`font`:return`pdf-text`;case`image`:case`color`:return`pdf-raster`;case`optimize`:return`pdf-optimize`;default:return`compile`}}function Ka(e){if(e===`source-read`||e===`content`||e===`optimize`)return`bytes`;if(e===`page`)return`pages`}function qa(e,t){let n=e.textIndex?.pages[t],r=[];if(!n||n.text.length===0)return r;let i=-1;for(let a=0;a<=n.charInstance.length;a+=1){if(a!==n.charInstance.length&&n.charInstance[a]!==-1){i<0&&(i=a);continue}if(i<0)continue;let o=n.text.slice(i,a).trim(),s=Ja(e,n,i,a);o.length!==0&&s&&r.push({text:o,...s,pageIndex:t}),i=-1}return r}function Ja(e,t,n,r){let i=1/0,a=1/0,o=-1/0,s=-1/0;for(let c=n;c<Math.min(r,t.charInstance.length);c+=1){let n=t.charInstance[c];if(n===-1)continue;if(n<=-2){let e=(-n-2)*4;e+3<t.fallbackQuads.length&&(i=Math.min(i,t.fallbackQuads[e]),a=Math.min(a,t.fallbackQuads[e+1]),o=Math.max(o,t.fallbackQuads[e+2]),s=Math.max(s,t.fallbackQuads[e+3]));continue}let r=n*4;if(r+3>=e.textInstanceA.length||r+3>=e.textInstanceB.length)continue;let l=Math.trunc(e.textInstanceB[r+2])*4;if(l<0||l+3>=e.textGlyphMetaA.length||l+1>=e.textGlyphMetaB.length)continue;let u=e.textInstanceA[r],d=e.textInstanceA[r+1],f=e.textInstanceA[r+2],p=e.textInstanceA[r+3],m=e.textInstanceB[r],h=e.textInstanceB[r+1],g=e.textGlyphMetaA[l+2],_=e.textGlyphMetaA[l+3],v=e.textGlyphMetaB[l],y=e.textGlyphMetaB[l+1],b=u*g+f*_+m,x=d*g+p*_+h,S=u*g+f*y+m,C=d*g+p*y+h,w=u*v+f*_+m,T=d*v+p*_+h,E=u*v+f*y+m,D=d*v+p*y+h,O=Math.min(b,S,w,E),k=Math.min(x,C,T,D),A=Math.max(b,S,w,E),j=Math.max(x,C,T,D),M=Math.trunc(e.textInstanceB[r+3]),N=(M-1)*4;M>0&&e.textClipRects&&N+3<e.textClipRects.length&&(O=Math.max(O,e.textClipRects[N]),k=Math.max(k,e.textClipRects[N+1]),A=Math.min(A,e.textClipRects[N+2]),j=Math.min(j,e.textClipRects[N+3])),O<=A&&k<=j&&(i=Math.min(i,O),a=Math.min(a,k),o=Math.max(o,A),s=Math.max(s,j))}return Number.isFinite(i)&&Number.isFinite(a)&&o>i&&s>a?{minX:i,minY:a,maxX:o,maxY:s}:null}function Ya(e){Ca(new Uint8Array(e,0,Math.min(e.byteLength,xa)))}function Xa(e,t,n){return $a(e,t,n)}function Za(e,t){return $a(e,1,t,!1,!0)}function Qa(e){return $a(e,1,void 0,!0)}function $a(e,t,r,i=!1,a=!1){if(e.length===0)return Ji();if(e.length===1&&!a)return Object.assign(Object.defineProperties({},Object.getOwnPropertyDescriptors(e[0])),{pageCount:Math.max(1,e[0].pageRects.length/4),pagesPerRow:1,pageTextRanges:io(e[0])});let o=yo(t,10,1,100),s=a?mo(e):po(e,o);if(i)for(let e of s)e.translateX=0,e.translateY=0;let c=e[0],l=a&&e.every(e=>e.textGlyphCount===c.textGlyphCount&&e.textGlyphSegmentCount===c.textGlyphSegmentCount&&e.textGlyphMetaA===c.textGlyphMetaA&&e.textGlyphMetaB===c.textGlyphMetaB&&e.textGlyphSegmentsA===c.textGlyphSegmentsA&&e.textGlyphSegmentsB===c.textGlyphSegmentsB),u=0,d=0,f=0,p=0,m=0,h=0,g=0,_=0,v=0,y=0,b=0,C=0,w=l?c.textGlyphCount:0,E=l?c.textGlyphSegmentCount:0,D=0,k=0,A=0,j=0,N=0,P=0,ee=0,F=0,te=0,ne=0,re=0,ae=!1;for(let t of e){ae||=t.textIndex!==null,u+=t.fillPathCount,d+=t.fillSegmentCount,f+=t.gradientCount,p+=t.gradientFillPathCount,m+=t.gradientFillSegmentCount,h+=t.gradientStrokeRunCount,g+=t.gradientStrokeSegmentCount,_+=t.segmentCount,v+=t.sourceSegmentCount,y+=t.mergedSegmentCount,b+=t.sourceTextCount,C+=t.textInstanceCount,l||(w+=t.textGlyphCount,E+=t.textGlyphSegmentCount),D+=Math.floor((t.textClipRects?.length??0)/4),k+=t.textInPageCount,A+=t.textOutOfPageCount,j+=t.imagePaintOpCount,N+=t.pathCount,P+=t.discardedTransparentCount,ee+=t.discardedDegenerateCount,F+=t.discardedDuplicateCount,te+=t.discardedContainedCount,ne=Math.max(ne,t.maxHalfWidth);let e=t.pageRects.length>=4?Math.floor(t.pageRects.length/4):1;re+=Math.max(1,e)}let I=new Float32Array(u*4),oe=new Float32Array(u*4),se=new Float32Array(u*4),ce=new Float32Array(d*4),le=new Float32Array(d*4),ue=new Float32Array(f*4),de=new Float32Array(f*4),fe=new Float32Array(f*4),pe=new Float32Array(f*4),me=new Float32Array(f*4),he=new Uint8Array(f*Aa*4),_e=e.some(e=>(e.gradientMeshIndices?.length??0)>0),ve=_e?new Uint32Array(f*2):void 0,L=_e?new Float32Array(e.reduce((e,t)=>e+(t.gradientMeshPositions?.length??0),0)):void 0,ye=_e?new Float32Array(e.reduce((e,t)=>e+(t.gradientMeshColors?.length??0),0)):void 0,be=_e?new Uint32Array(e.reduce((e,t)=>e+(t.gradientMeshIndices?.length??0),0)):void 0,xe=0,Se=0,Ce=new Float32Array(p*4),we=new Float32Array(p*4),Te=new Float32Array(p*4),Ee=new Float32Array(p*4),De=new Float32Array(m*4),Oe=new Float32Array(m*4),ke=new Float32Array(h*4),Ae=new Float32Array(h*4),je=new Float32Array(g*4),Me=new Float32Array(g*4),Ne=new Float32Array(g*4),Pe=new Float32Array(g*4),Fe=new Float32Array(_*4),Ie=new Float32Array(_*4),Le=new Float32Array(_*4),Re=new Float32Array(_*4),ze=new Float32Array(C*4),Be=new Float32Array(C*4),Ve=new Float32Array(C*4),He=new Float32Array(D*4),Ue=l?c.textGlyphMetaA:new Float32Array(w*4),We=l?c.textGlyphMetaB:new Float32Array(w*4),Ge=l?c.textGlyphSegmentsA:new Float32Array(E*4),Ke=l?c.textGlyphSegmentsB:new Float32Array(E*4),qe=new Float32Array(re*4),Je=e.some(e=>e.pendingPagePreviews?.some(Boolean))?new Uint8Array(re):void 0,Ye=new Uint32Array(re*2),Xe=0,Ze=0,Qe=0,$e=0,et=0,tt=0,nt=0,rt=0,it=0,at=0,ot=0,st=0,ct=0,lt=null,ut=null,dt=a&&e.every(t=>t.optionalContent===e[0].optionalContent)?{data:e[0].optionalContent,offsets:e.map(()=>0),droppedAnnotationLayers:0}:ya(e.map(e=>e.optionalContent));dt.droppedAnnotationLayers&&r?.({code:`annotation.layer-limit`,severity:`warning`,message:`${dt.droppedAnnotationLayers} annotation appearance(s) exceed the scene's layer limit and cannot be hidden individually.`,details:{annotationCount:dt.droppedAnnotationLayers}});let ft=e.some(e=>e.paintGraph)?{roots:[]}:void 0,pt=[],mt=[],ht=ft||e.some(e=>e.drawRuns)?[]:void 0,gt=e.every(e=>e.pageRects.length<=4||e.pagePrimitiveRanges)?new Uint32Array(re*Hi):void 0,_t=[],vt=[],yt=[],bt=[],xt=[],St=[],Ct=!1;for(let t=0;t<e.length;t+=1){let r=e[t],i=s[t];ie(r);let a=i.translateX,o=i.translateY,c=ct;if(St.push({scene:r,offsets:{pageRectBase:c,primitives:{fill:Xe,stroke:rt,text:it,raster:_t.length,"gradient-fill":$e,"gradient-stroke":tt}}}),gt){Wi(r);let e=[rt,Xe,it,_t.length,$e,tt],t=Ui(Object.assign(Object.defineProperties({},Object.getOwnPropertyDescriptors(r)),{rasterLayers:vo(r)})),n=Math.max(1,r.pageRects.length/4);for(let i=0;i<n;i++)Vi.forEach((n,a)=>{let o=i*Hi+a*2,s=(c+i)*Hi+a*2;gt[s]=e[a]+(r.pagePrimitiveRanges?.[o]??0),gt[s+1]=r.pagePrimitiveRanges?.[o+1]??t[n]})}for(let e of r.pdfPages??[]){let[t,n,r,i,s,l]=e.pdfToScene;xt.push({...e,pageIndex:c+e.pageIndex,pdfToScene:[t,n,r,i,s+a,l+o]})}for(let e of r.annotations??[])bt.push(n(e,c+e.pageIndex,a,o,dt.offsets[t]));let u=mt.length,d=pt.length;for(let e of r.retainedPages??[]){let n=e.matrix.slice();n[4]+=a,n[5]+=o,pt.push({page:e.page,matrix:n,optionalContentConditions:e.optionalContentConditions.map(e=>e<0?e:e+dt.offsets[t])})}for(let e of r.clipPaths??[]){let t=e.edges.slice();for(let e=0;e<t.length;e+=2)t[e]+=a,t[e+1]+=o;mt.push({parent:e.parent<0?-1:e.parent+u,fillRule:e.fillRule,edges:t})}if(ht){T(r);let e=ht.length,n={fill:Xe,stroke:rt,text:it,raster:_t.length,"gradient-fill":$e,"gradient-stroke":tt};for(let e of r.drawRuns??x(Object.assign(Object.defineProperties({},Object.getOwnPropertyDescriptors(r)),{rasterLayers:vo(r)}))){let r=e.clipIndex===void 0?void 0:e.clipIndex+u,i=e.optionalContent===void 0?void 0:e.optionalContent+dt.offsets[t];ft||e.pdfRepresentation?ht.push({...e,first:e.first+n[e.kind],...e.pdfRepresentation?{pdfRepresentation:{...e.pdfRepresentation,pageIndex:c+e.pdfRepresentation.pageIndex}}:{},...r===void 0?{}:{clipIndex:r},...i===void 0?{}:{optionalContent:i}}):O(ht,e.kind,e.first+n[e.kind],e.count,r,e.blendMode,i)}if(ft){if(r.paintGraph)ft.roots.push(...va(r.paintGraph,{run:e,raster:_t.length,retainedPage:d,condition:dt.offsets[t],x:a,y:o}).roots);else for(let t=e;t<ht.length;t++)ft.roots.push({kind:`draw`,runIndex:t})}}if(r.textContent){Ct=!0;for(let e of r.textContent)yt.push({text:e.text,minX:e.minX+a,minY:e.minY+o,maxX:e.maxX+a,maxY:e.maxY+o,pageIndex:c+e.pageIndex})}for(let e=0;e<r.fillPathCount;e+=1){let t=e*4,n=(Xe+e)*4;I[n]=r.fillPathMetaA[t]+Ze,I[n+1]=r.fillPathMetaA[t+1],I[n+2]=r.fillPathMetaA[t+2]+a,I[n+3]=r.fillPathMetaA[t+3]+o,oe[n]=r.fillPathMetaB[t]+a,oe[n+1]=r.fillPathMetaB[t+1]+o,oe[n+2]=r.fillPathMetaB[t+2],oe[n+3]=r.fillPathMetaB[t+3],se[n]=r.fillPathMetaC[t],se[n+1]=r.fillPathMetaC[t+1],se[n+2]=r.fillPathMetaC[t+2],se[n+3]=r.fillPathMetaC[t+3]}for(let e=0;e<r.fillSegmentCount;e+=1){let t=e*4,n=(Ze+e)*4;ce[n]=r.fillSegmentsA[t]+a,ce[n+1]=r.fillSegmentsA[t+1]+o,ce[n+2]=r.fillSegmentsA[t+2]+a,ce[n+3]=r.fillSegmentsA[t+3]+o,le[n]=r.fillSegmentsB[t]+a,le[n+1]=r.fillSegmentsB[t+1]+o,le[n+2]=r.fillSegmentsB[t+2],le[n+3]=r.fillSegmentsB[t+3]}if(ve&&L&&ye&&be&&r.gradientMeshIndices){L.set(r.gradientMeshPositions,xe*2),ye.set(r.gradientMeshColors,xe*4);for(let e=0;e<r.gradientMeshIndices.length;e++)be[Se+e]=r.gradientMeshIndices[e]+xe;for(let e=0;e<r.gradientCount;e++)ve[(Qe+e)*2]=r.gradientMeshRanges[e*2]+Se,ve[(Qe+e)*2+1]=r.gradientMeshRanges[e*2+1];xe+=r.gradientMeshPositions.length/2,Se+=r.gradientMeshIndices.length}for(let e=0;e<r.gradientCount;e+=1){let t=e*4,n=(Qe+e)*4;ue.set(r.gradientMetaA.subarray(t,t+4),n),de.set(r.gradientMetaB.subarray(t,t+4),n),fe[n]=r.gradientMetaC[t]-r.gradientMetaB[t]*a-r.gradientMetaB[t+2]*o,fe[n+1]=r.gradientMetaC[t+1]-r.gradientMetaB[t+1]*a-r.gradientMetaB[t+3]*o,fe[n+2]=r.gradientMetaC[t+2],fe[n+3]=r.gradientMetaC[t+3],pe.set(r.gradientMetaD.subarray(t,t+4),n),me.set(r.gradientMetaE.subarray(t,t+4),n);let i=e*Aa*4,s=(Qe+e)*Aa*4;he.set(r.gradientLut.subarray(i,i+Aa*4),s)}for(let e=0;e<r.gradientFillPathCount;e+=1){let t=e*4,n=($e+e)*4;Ce[n]=r.gradientFillPathMetaA[t]+et,Ce[n+1]=r.gradientFillPathMetaA[t+1],Ce[n+2]=r.gradientFillPathMetaA[t+2]+a,Ce[n+3]=r.gradientFillPathMetaA[t+3]+o,we[n]=r.gradientFillPathMetaB[t]+a,we[n+1]=r.gradientFillPathMetaB[t+1]+o,we[n+2]=r.gradientFillPathMetaB[t+2],we[n+3]=r.gradientFillPathMetaB[t+3],Te.set(r.gradientFillPathMetaC.subarray(t,t+4),n);let i=r.gradientFillPaintMeta[t],s=r.gradientFillPaintMeta[t+1];Ee[n]=i>=0?i+Qe:-1,Ee[n+1]=s>=0?s+Qe:-1,Ee[n+2]=r.gradientFillPaintMeta[t+2],Ee[n+3]=c+r.gradientFillPaintMeta[t+3]}for(let e=0;e<r.gradientFillSegmentCount;e+=1){let t=e*4,n=(et+e)*4;De[n]=r.gradientFillSegmentsA[t]+a,De[n+1]=r.gradientFillSegmentsA[t+1]+o,De[n+2]=r.gradientFillSegmentsA[t+2]+a,De[n+3]=r.gradientFillSegmentsA[t+3]+o,Oe[n]=r.gradientFillSegmentsB[t]+a,Oe[n+1]=r.gradientFillSegmentsB[t+1]+o,Oe[n+2]=r.gradientFillSegmentsB[t+2],Oe[n+3]=r.gradientFillSegmentsB[t+3]}for(let e=0;e<r.gradientStrokeRunCount;e+=1){let t=e*4,n=(tt+e)*4;ke[n]=r.gradientStrokeRunMetaA[t]+nt,ke[n+1]=r.gradientStrokeRunMetaA[t+1];let i=r.gradientStrokeRunMetaA[t+2],a=r.gradientStrokeRunMetaA[t+3];ke[n+2]=i>=0?i+Qe:-1,ke[n+3]=a>=0?a+Qe:-1,Ae[n]=r.gradientStrokeRunMetaB[t],Ae[n+1]=c+r.gradientStrokeRunMetaB[t+1],Ae[n+2]=0,Ae[n+3]=0}for(let e=0;e<r.gradientStrokeSegmentCount;e+=1){let t=e*4,n=(nt+e)*4;je[n]=r.gradientStrokeEndpoints[t]+a,je[n+1]=r.gradientStrokeEndpoints[t+1]+o,je[n+2]=r.gradientStrokeEndpoints[t+2]+a,je[n+3]=r.gradientStrokeEndpoints[t+3]+o,Me[n]=r.gradientStrokePrimitiveMeta[t]+a,Me[n+1]=r.gradientStrokePrimitiveMeta[t+1]+o,Me[n+2]=r.gradientStrokePrimitiveMeta[t+2],Me[n+3]=r.gradientStrokePrimitiveMeta[t+3],Ne[n]=r.gradientStrokePrimitiveBounds[t]+a,Ne[n+1]=r.gradientStrokePrimitiveBounds[t+1]+o,Ne[n+2]=r.gradientStrokePrimitiveBounds[t+2]+a,Ne[n+3]=r.gradientStrokePrimitiveBounds[t+3]+o,Pe.set(r.gradientStrokeStyles.subarray(t,t+4),n)}for(let e=0;e<r.segmentCount;e+=1){let t=e*4,n=(rt+e)*4;Fe[n]=r.endpoints[t]+a,Fe[n+1]=r.endpoints[t+1]+o,Fe[n+2]=r.endpoints[t+2]+a,Fe[n+3]=r.endpoints[t+3]+o,Ie[n]=r.primitiveMeta[t]+a,Ie[n+1]=r.primitiveMeta[t+1]+o,Ie[n+2]=r.primitiveMeta[t+2],Ie[n+3]=r.primitiveMeta[t+3],Le[n]=r.primitiveBounds[t]+a,Le[n+1]=r.primitiveBounds[t+1]+o,Le[n+2]=r.primitiveBounds[t+2]+a,Le[n+3]=r.primitiveBounds[t+3]+o,Re[n]=r.styles[t],Re[n+1]=r.styles[t+1],Re[n+2]=r.styles[t+2],Re[n+3]=r.styles[t+3]}ze.set(r.textInstanceA,it*4),Ve.set(r.textInstanceC,it*4);for(let e=0;e<r.textInstanceCount;e+=1){let t=e*4,n=(it+e)*4;Be[n]=r.textInstanceB[t]+a,Be[n+1]=r.textInstanceB[t+1]+o,Be[n+2]=r.textInstanceB[t+2]+at;let i=r.textInstanceB[t+3];Be[n+3]=i>0?i+st:0}let f=r.textClipRects;if(f){for(let e=0;e<f.length;e+=4){let t=st*4+e;He[t]=f[e]+a,He[t+1]=f[e+1]+o,He[t+2]=f[e+2]+a,He[t+3]=f[e+3]+o}st+=f.length/4}for(let e=0;!l&&e<r.textGlyphCount;e+=1){let t=e*4,n=(at+e)*4;Ue[n]=r.textGlyphMetaA[t]+ot,Ue[n+1]=r.textGlyphMetaA[t+1],Ue[n+2]=r.textGlyphMetaA[t+2],Ue[n+3]=r.textGlyphMetaA[t+3],We[n]=r.textGlyphMetaB[t],We[n+1]=r.textGlyphMetaB[t+1],We[n+2]=r.textGlyphMetaB[t+2],We[n+3]=r.textGlyphMetaB[t+3]}l||(Ge.set(r.textGlyphSegmentsA,ot*4),Ke.set(r.textGlyphSegmentsB,ot*4));let p=r.pageRects;if(p.length>=4){let e=Math.floor(p.length/4),n=io(r,e);for(let t=0;t<e;t+=1){let e=t*4,i=(ct+t)*4;qe[i]=p[e]+a,qe[i+1]=p[e+1]+o,qe[i+2]=p[e+2]+a,qe[i+3]=p[e+3]+o,Je&&(Je[ct+t]=r.pendingPagePreviews?.[t]??0);let s=(ct+t)*2,c=t*2;Ye[s]=n[c]+it,Ye[s+1]=n[c+1]}eo(vt,r,e,a,o,it,dt.offsets[t]),ct+=e}else{let e=ct*4;qe[e]=r.pageBounds.minX+a,qe[e+1]=r.pageBounds.minY+o,qe[e+2]=r.pageBounds.maxX+a,qe[e+3]=r.pageBounds.maxY+o,Je&&(Je[ct]=r.pendingPagePreviews?.[0]??0);let n=ct*2;Ye[n]=it,Ye[n+1]=r.textInstanceCount,eo(vt,r,1,a,o,it,dt.offsets[t]),ct+=1}lt=xo(lt,_o(r.bounds,a,o)),ut=xo(ut,_o(r.pageBounds,a,o));for(let e of vo(r)){if(e.matrix.length<6)continue;let t=new Float32Array(6);t[0]=e.matrix[0],t[1]=e.matrix[1],t[2]=e.matrix[2],t[3]=e.matrix[3],t[4]=e.matrix[4]+a,t[5]=e.matrix[5]+o,_t.push(ge(e,{matrix:t,...e.repeat?{repeat:M(e.repeat,a,o)}:{},paintOrder:e.paintOrder,pageIndex:c+e.pageIndex}))}Xe+=r.fillPathCount,Ze+=r.fillSegmentCount,Qe+=r.gradientCount,$e+=r.gradientFillPathCount,et+=r.gradientFillSegmentCount,tt+=r.gradientStrokeRunCount,nt+=r.gradientStrokeSegmentCount,rt+=r.segmentCount,it+=r.textInstanceCount,l||(at+=r.textGlyphCount,ot+=r.textGlyphSegmentCount)}let wt=_t[0]??null,Tt=new Uint8Array,{droppedPages:R,...Et}=S(St);R&&r?.({code:`structure.limit`,severity:`warning`,message:`${R} page(s) exceed the scene's structure attribution limit; their content has no MCIDs.`,details:{pageCount:R}});let Dt={annotations:bt,...e[0].annotationAppearances?{annotationAppearances:e[0].annotationAppearances}:{},...Et,pdfPages:xt,...ft?{paintGraph:ft}:{},...pt.length?{retainedPages:pt}:{},...dt.data?{optionalContent:dt.data}:{},...mt.length?{clipPaths:mt}:{},...ht?{drawRuns:ht}:{},pageCount:re,pagesPerRow:o,pageRects:qe,...Je?{pendingPagePreviews:Je}:{},pageTextRanges:Ye,...gt?{pagePrimitiveRanges:gt}:{},textIndex:ae?{version:2,pages:vt}:null,fillPathCount:u,fillSegmentCount:d,fillPathMetaA:I,fillPathMetaB:oe,fillPathMetaC:se,fillSegmentsA:ce,fillSegmentsB:le,gradientCount:f,gradientMetaA:ue,gradientMetaB:de,gradientMetaC:fe,gradientMetaD:pe,gradientMetaE:me,gradientLut:he,..._e?{gradientMeshRanges:ve,gradientMeshPositions:L,gradientMeshColors:ye,gradientMeshIndices:be}:{},gradientFillPathCount:p,gradientFillSegmentCount:m,gradientFillPathMetaA:Ce,gradientFillPathMetaB:we,gradientFillPathMetaC:Te,gradientFillPaintMeta:Ee,gradientFillSegmentsA:De,gradientFillSegmentsB:Oe,gradientStrokeRunCount:h,gradientStrokeSegmentCount:g,gradientStrokeRunMetaA:ke,gradientStrokeRunMetaB:Ae,gradientStrokeEndpoints:je,gradientStrokePrimitiveMeta:Me,gradientStrokePrimitiveBounds:Ne,gradientStrokeStyles:Pe,segmentCount:_,sourceSegmentCount:v,mergedSegmentCount:y,...e.every(e=>e.imageLayerSegmentCount!==void 0)?{imageLayerSegmentCount:e.reduce((e,t)=>e+t.imageLayerSegmentCount,0)}:{},sourceTextCount:b,textInstanceCount:C,textGlyphCount:w,textGlyphSegmentCount:E,textInPageCount:k,textOutOfPageCount:A,textInstanceA:ze,textInstanceB:Be,textInstanceC:Ve,...He.length===0?{}:{textClipRects:He},textGlyphMetaA:Ue,textGlyphMetaB:We,textGlyphSegmentsA:Ge,textGlyphSegmentsB:Ke,rasterLayers:_t,rasterLayerWidth:wt?.width??0,rasterLayerHeight:wt?.height??0,get rasterLayerData(){return wt?.data??Tt},rasterLayerMatrix:wt?.matrix??new Float32Array([1,0,0,1,0,0]),endpoints:Fe,primitiveMeta:Ie,primitiveBounds:Le,styles:Re,bounds:lt??{minX:0,minY:0,maxX:1,maxY:1},pageBounds:ut??lt??{minX:0,minY:0,maxX:1,maxY:1},maxHalfWidth:ne,imagePaintOpCount:j,pathCount:N,discardedTransparentCount:P,discardedDegenerateCount:ee,discardedDuplicateCount:F,discardedContainedCount:te};return Ct&&(Dt.textContent=yt),no(Dt)}function eo(e,t,n,r,i,a,o=0){let s=t.textIndex?.pages??[];for(let t=0;t<n;t+=1){let n=s[t];n&&n.text.length>0?e.push(to(n,r,i,a,o)):e.push({text:``,charInstance:new Int32Array,fallbackQuads:new Float32Array})}}function to(e,t,n,r,i=0){let a=new Int32Array(e.charInstance.length);for(let t=0;t<a.length;t+=1){let n=e.charInstance[t];a[t]=n>=0?n+r:n}let o=e.fallbackQuads,s=new Float32Array(o.length);for(let e=0;e+3<o.length;e+=4)s[e]=o[e]+t,s[e+1]=o[e+1]+n,s[e+2]=o[e+2]+t,s[e+3]=o[e+3]+n;return{text:e.text,charInstance:a,fallbackQuads:s,...e.optionalContent?{optionalContent:Int32Array.from(e.optionalContent,e=>e<0?-1:e+i)}:{}}}function no(e){let t=Math.max(0,e.textGlyphCount|0),n=Math.max(0,e.textGlyphSegmentCount|0);if(t<=1||n<=0||e.textGlyphMetaA.length<t*4||e.textGlyphMetaB.length<t*4)return e;let r=new Uint32Array(e.textGlyphSegmentsA.buffer,e.textGlyphSegmentsA.byteOffset,e.textGlyphSegmentsA.length),i=new Uint32Array(e.textGlyphSegmentsB.buffer,e.textGlyphSegmentsB.byteOffset,e.textGlyphSegmentsB.length),a=new Uint32Array(e.textGlyphMetaA.buffer,e.textGlyphMetaA.byteOffset,e.textGlyphMetaA.length),o=new Uint32Array(e.textGlyphMetaB.buffer,e.textGlyphMetaB.byteOffset,e.textGlyphMetaB.length),s=new Uint32Array(t),c=[],l=new Map,u=new ka(Math.min(t,4096)),d=new ka(Math.min(t,4096)),f=new ka(Math.min(n,65536)),p=new ka(Math.min(n,65536));for(let n=0;n<t;n+=1){let t=ao(e,n,a,o,r,i),m=l.get(t),h=-1;if(m){for(let t of m)if(oo(e,n,c[t])){h=t;break}}if(h<0){h=c.length,c.push(n),m?m.push(h):l.set(t,[h]);let r=n*4,i=Math.max(0,Math.trunc(e.textGlyphMetaA[r])),a=Math.max(0,Math.trunc(e.textGlyphMetaA[r+1])),o=i*4,s=Math.min(a*4,Math.max(0,e.textGlyphSegmentsA.length-o),Math.max(0,e.textGlyphSegmentsB.length-o)),g=f.quadCount;f.append(e.textGlyphSegmentsA,o,s),p.append(e.textGlyphSegmentsB,o,s),u.push(g,s/4,e.textGlyphMetaA[r+2],e.textGlyphMetaA[r+3]),d.push(e.textGlyphMetaB[r],e.textGlyphMetaB[r+1],e.textGlyphMetaB[r+2],e.textGlyphMetaB[r+3])}s[n]=h}if(c.length===t)return e;let m=e.textInstanceB;for(let t=0;t<e.textInstanceCount;t+=1){let e=t*4+2,n=Math.max(0,Math.trunc(m[e]));n<s.length&&(m[e]=s[n])}return Object.assign(Object.defineProperties({},Object.getOwnPropertyDescriptors(e)),{textInstanceB:m,textGlyphCount:c.length,textGlyphSegmentCount:f.quadCount,textGlyphMetaA:u.toTypedArray(),textGlyphMetaB:d.toTypedArray(),textGlyphSegmentsA:f.toTypedArray(),textGlyphSegmentsB:p.toTypedArray()})}function ro(e,t,n){let r=Math.max(1,Math.floor(e.length/4)),i=new Uint32Array(r*2),a=Math.max(0,Math.min(n|0,Math.floor(t.length/4)));if(r<=1||a<=0)return i[0]=0,i[1]=a,i;let o=co(e,r),s=0,c=0;for(let n=0;n<a;n+=1){let a=n*4,l=t[a],u=t[a+1];if(!Number.isFinite(l)||!Number.isFinite(u)||uo(e,s,l,u,o))continue;let d=lo(e,r,s+1,l,u,o);if(!(d<=s)){i[s*2]=c,i[s*2+1]=n-c;for(let e=s+1;e<d;e+=1)i[e*2]=n,i[e*2+1]=0;s=d,c=n}}i[s*2]=c,i[s*2+1]=a-c;for(let e=s+1;e<r;e+=1)i[e*2]=a,i[e*2+1]=0;return i}function io(e,t){let n=Math.floor(e.pageRects.length/4)||e.pageCount||1,r=Math.max(1,t??n)*2;return e.pageTextRanges instanceof Uint32Array&&e.pageTextRanges.length>=r?e.pageTextRanges.subarray(0,r):ro(e.pageRects,e.textInstanceB,e.textInstanceCount)}function ao(e,t,n,r,i,a){let o=t*4,s=Math.max(0,Math.trunc(e.textGlyphMetaA[o])),c=Math.max(0,Math.trunc(e.textGlyphMetaA[o+1])),l=s*4,u=Math.min(c*4,Math.max(0,i.length-l),Math.max(0,a.length-l)),d=2166136261;d=so(d,c),d=so(d,n[o+2]??0),d=so(d,n[o+3]??0),d=so(d,r[o]??0),d=so(d,r[o+1]??0);for(let e=0;e<u;e+=1)d=so(d,i[l+e]),d=so(d,a[l+e]);return`${c}:${d>>>0}`}function oo(e,t,n){if(t===n)return!0;let r=t*4,i=n*4,a=Math.max(0,Math.trunc(e.textGlyphMetaA[r+1]));if(a!==Math.max(0,Math.trunc(e.textGlyphMetaA[i+1]))||e.textGlyphMetaA[r+2]!==e.textGlyphMetaA[i+2]||e.textGlyphMetaA[r+3]!==e.textGlyphMetaA[i+3]||e.textGlyphMetaB[r]!==e.textGlyphMetaB[i]||e.textGlyphMetaB[r+1]!==e.textGlyphMetaB[i+1]||e.textGlyphMetaB[r+2]!==e.textGlyphMetaB[i+2]||e.textGlyphMetaB[r+3]!==e.textGlyphMetaB[i+3])return!1;let o=Math.max(0,Math.trunc(e.textGlyphMetaA[r])),s=Math.max(0,Math.trunc(e.textGlyphMetaA[i])),c=o*4,l=s*4,u=a*4;for(let t=0;t<u;t+=1)if(e.textGlyphSegmentsA[c+t]!==e.textGlyphSegmentsA[l+t]||e.textGlyphSegmentsB[c+t]!==e.textGlyphSegmentsB[l+t])return!1;return!0}function so(e,t){return e^=t>>>0,Math.imul(e,16777619)}function co(e,t){let n=0,r=0;for(let i=0;i<t;i+=1){let t=i*4,a=Math.abs(e[t+2]-e[t]),o=Math.abs(e[t+3]-e[t+1]),s=Math.max(a,o);Number.isFinite(s)&&s>0&&(n+=s,r+=1)}return r===0?8:fo(n/r*.025,4,24)}function lo(e,t,n,r,i,a){for(let o=Math.max(0,n);o<t;o+=1)if(uo(e,o,r,i,a))return o;return-1}function uo(e,t,n,r,i){let a=t*4,o=Math.min(e[a],e[a+2])-i,s=Math.max(e[a],e[a+2])+i,c=Math.min(e[a+1],e[a+3])-i,l=Math.max(e[a+1],e[a+3])+i;return n>=o&&n<=s&&r>=c&&r<=l}function fo(e,t,n){return e<t?t:e>n?n:e}function po(e,t){let n=e.map(e=>ho(e.pageBounds,e.bounds)),r=Math.ceil(e.length/t),i=new Float64Array(r),a=0;for(let e=0;e<n.length;e+=1){let r=n[e],o=Math.max(r.maxX-r.minX,.001),s=Math.max(r.maxY-r.minY,.001);a+=Math.max(o,s);let c=Math.floor(e/t);i[c]=Math.max(i[c],s)}let o=a/Math.max(1,n.length),s=Math.max(o*Ma,Na),c=new Float64Array(r);for(let e=1;e<r;e+=1)c[e]=c[e-1]-i[e-1]-s;let l=new Float64Array(r),u=Array(e.length);for(let e=0;e<n.length;e+=1){let r=n[e],i=Math.max(r.maxX-r.minX,.001),a=Math.floor(e/t),o=l[a]-r.minX,d=c[a]-r.maxY;u[e]={translateX:o,translateY:d},l[a]+=i+s}return u}function mo(e){let t=0;return e.map(e=>{let n=ho(e.pageBounds,e.bounds),r={translateX:-(n.minX+n.maxX)/2,translateY:t-n.maxY};return t-=Math.max(n.maxY-n.minY,.001)+16,r})}function ho(e,t){let n=go(e)?e:t;return go(n)?n:{minX:0,minY:0,maxX:1,maxY:1}}function go(e){return Number.isFinite(e.minX)&&Number.isFinite(e.minY)&&Number.isFinite(e.maxX)&&Number.isFinite(e.maxY)}function _o(e,t,n){return{minX:e.minX+t,minY:e.minY+n,maxX:e.maxX+t,maxY:e.maxY+n}}function vo(e){let t=[];if(Array.isArray(e.rasterLayers))for(let n of e.rasterLayers){let e=Math.max(0,Math.trunc(n?.width??0)),r=Math.max(0,Math.trunc(n?.height??0));if(e<=0||r<=0||(n.monochrome?!(n.monochrome.data instanceof Uint8Array)||n.monochrome.data.length!==Math.ceil(e/8)*r||n.monochrome.colors.length!==8:!(n.data instanceof Uint8Array)||n.data.length<e*r*4&&!Bi(n.data)))continue;let i=new Float32Array(6);n.matrix.length>=6?(i[0]=n.matrix[0],i[1]=n.matrix[1],i[2]=n.matrix[2],i[3]=n.matrix[3],i[4]=n.matrix[4],i[5]=n.matrix[5]):(i[0]=1,i[3]=1),t.push(ge(n,{width:e,height:r,matrix:i,...n.opacity===void 0?{}:{opacity:n.opacity},paintOrder:Number.isFinite(n.paintOrder)?n.paintOrder:0,pageIndex:Number.isFinite(n.pageIndex)?Math.max(0,Math.trunc(n.pageIndex)):0}))}if(t.length>0)return t;let n=Math.max(0,Math.trunc(e.rasterLayerWidth)),r=Math.max(0,Math.trunc(e.rasterLayerHeight));if(n<=0||r<=0||e.rasterLayerData.length<n*r*4)return t;let i=new Float32Array([1,0,0,1,0,0]);return e.rasterLayerMatrix.length>=6&&(i[0]=e.rasterLayerMatrix[0],i[1]=e.rasterLayerMatrix[1],i[2]=e.rasterLayerMatrix[2],i[3]=e.rasterLayerMatrix[3],i[4]=e.rasterLayerMatrix[4],i[5]=e.rasterLayerMatrix[5]),t.push({width:n,height:r,data:e.rasterLayerData,matrix:i,paintOrder:0,pageIndex:0}),t}function yo(e,t,n,r){let i=Math.trunc(Number(e)),a=Number.isFinite(i)?i:t;return a<n?n:a>r?r:a}function bo(e,t){if(t!==void 0&&typeof t!=`string`)throw TypeError(`pages must be a string.`);let n=t?.trim()??``;if(n.length===0)return Array.from({length:e},(e,t)=>t+1);let r=new Set;for(let i of n.split(`,`)){let n=i.trim(),a=/^(\d+)$/.exec(n),o=/^(\d*)\s*-\s*(\d*)$/.exec(n);if(!a&&!o)throw RangeError(`Invalid pages value "${t}". Use comma-separated page numbers or inclusive ranges such as "1-5, 8, 11-13".`);let s=a?Number(a[1]):o?.[1]?Number(o[1]):1,c=a?s:o?.[2]?Number(o[2]):e;if(!Number.isSafeInteger(s)||!Number.isSafeInteger(c))throw RangeError(`Invalid page range "${n}": page numbers must be safe integers.`);if(s<1||s>e||c<1||c>e)throw RangeError(`PDF page number ${s<1||s>e?s:c} is out of range; the document contains ${e} page${e===1?``:`s`}.`);if(s>c)throw RangeError(`Invalid page range "${n}": the first page must not exceed the last page.`);for(let e=s;e<=c;e+=1)r.add(e)}return Array.from(r).sort((e,t)=>e-t)}function xo(e,t){if(!e&&!t)return null;if(!e&&t)return{...t};if(e&&!t)return{...e};let n=e,r=t;return{minX:Math.min(n.minX,r.minX),minY:Math.min(n.minY,r.minY),maxX:Math.max(n.maxX,r.maxX),maxY:Math.max(n.maxY,r.maxY)}}function So(e){return e<=0?0:e>=1?1:e}var Co=4294967295,wo=4294967295,To=65536,Eo=new TextEncoder,Do=new TextDecoder(`utf-8`,{fatal:!0,ignoreBOM:!0}),Oo=new Uint32Array(2048);for(let e=0;e<256;e+=1){let t=e;for(let e=0;e<8;e+=1)t=t>>>1^(t&1?3988292384:0);Oo[e]=t>>>0}for(let e=0;e<256;e+=1)for(let t=1;t<8;t+=1){let n=Oo[(t-1)*256+e];Oo[t*256+e]=n>>>8^Oo[n&255]}function ko(e){let t=4294967295,n=0;for(let r=e.length-7;n<r;n+=8){let r=t^(e[n]|e[n+1]<<8|e[n+2]<<16|e[n+3]<<24);t=Oo[1792+(r&255)]^Oo[1536+(r>>>8&255)]^Oo[1280+(r>>>16&255)]^Oo[1024+(r>>>24)]^Oo[768+e[n+4]]^Oo[512+e[n+5]]^Oo[256+e[n+6]]^Oo[e[n+7]]}for(;n<e.length;n+=1)t=Oo[(t^e[n])&255]^t>>>8;return(t^4294967295)>>>0}function Ao(e){return e instanceof Uint8Array?e:new Uint8Array(e)}function jo(e){let t=Ao(e);return t.length>=4&&t[0]===72&&t[1]===69&&t[2]===80&&t[3]===0}function Mo(e){let t=Ao(e);return t.length>=4&&t[0]===80&&t[1]===75&&(t[2]===3&&t[3]===4||t[2]===5&&t[3]===6||t[2]===7&&t[3]===8)}function No(e){return Math.ceil(e/4)*4}function z(e){throw Error(`Invalid HEP container: ${e}`)}function Po(e,t,n,r){for(let i=t;i<n;i+=1)e[i]!==0&&z(`nonzero ${r}.`)}function Fo(e){(!e||e.includes(`\0`)||e.includes(`\\`)||e.split(`/`).some(e=>!e||e===`.`||e===`..`))&&z(`invalid section name ${JSON.stringify(e)}.`);let t=Eo.encode(e);return(t.length>65535||Do.decode(t)!==e)&&z(`invalid UTF-8 section name.`),t}function Io(e,t){let n=wo;if(t&&Object.hasOwn(t,e)){let r=t[e];(!Number.isSafeInteger(r)||r<0)&&z(`invalid byte limit for ${e}.`),n=Math.min(n,r)}return n}function Lo(e,t,n){(!Number.isSafeInteger(t)||t<0||t>Io(e,n))&&z(`section ${e} exceeds its decoded byte limit.`)}async function Ro(e,t,n,r){r?.throwIfAborted();let i=t?globalThis.CompressionStream:globalThis.DecompressionStream;if(typeof i!=`function`)throw Error(`HEP ${t?`compression`:`decompression`} requires native ${t?`CompressionStream`:`DecompressionStream`}("deflate"). Use a current Node.js release or modern browser`+(t?`, or export with compression: "store".`:`.`));let a=new i(`deflate`),o=a.readable.getReader(),s=a.writable.getWriter(),c,l=!1,u=e=>{l||(l=!0,c=e),o.cancel(e).catch(()=>{}),s.abort(e).catch(()=>{})},d=()=>u(r?.reason);r?.addEventListener(`abort`,d,{once:!0});let f=(async()=>{try{for(let t=0;t<e.length;t+=To){r?.throwIfAborted();let n=e.subarray(t,t+To);await s.write(n.buffer instanceof ArrayBuffer?n:new Uint8Array(n))}await s.close()}catch(e){u(e)}})();try{let e=[],t=0;for(;;){r?.throwIfAborted();let i=await o.read();if(i.done)break;t+=i.value.length,t>n&&z(`decompressed output exceeds the declared chunk length or byte limit.`),e.push(i.value)}if(await f,r?.throwIfAborted(),l)throw c;let i=new Uint8Array(t),a=0;for(let t of e)i.set(t,a),a+=t.length;return i}catch(e){throw u(e),await f,r?.aborted?r.reason:e}finally{r?.removeEventListener(`abort`,d),o.releaseLock(),s.releaseLock()}}var zo=4096;function Bo(e){let t=e.indexOf(`/`);if(!(e===`manifest.json`||e===`source.pdf`||t<0||e.startsWith(`raster/`)||e.startsWith(`source/`)||/\.pdf$/i.test(e)))return e.slice(0,t)}function Vo(e){return/\.(webp|png)$/i.test(e)}var Ho=4*Float32Array.BYTES_PER_ELEMENT;function Uo(e,t){if(!Number.isSafeInteger(t)||t<=0||e.byteLength<4)throw Error(`Invalid Float32 palette item count or header.`);if(t>4294967295/Ho)throw Error(`Float32 palette exceeds the 32-bit decoded byte length field.`);let n=new DataView(e.buffer,e.byteOffset,e.byteLength),r=n.getUint16(0,!0);if(r<1||r>256||r>t||n.getUint16(2,!0)!==0)throw Error(`Invalid Float32 palette count or reserved fields.`);let i=4+r*Ho;if(e.byteLength!==i+t)throw Error(`Float32 palette payload length does not match its item count.`);for(let t=i;t<e.length;t++)if(e[t]>=r)throw Error(`Float32 palette index is out of range.`);let a=new Uint32Array(r*4);for(let e=0;e<a.length;e++)a[e]=n.getUint32(4+e*4,!0);let o=new Float32Array(t*4),s=new Uint32Array(o.buffer);for(let n=0;n<t;n++){let t=e[i+n]*4,r=n*4;s[r]=a[t],s[r+1]=a[t+1],s[r+2]=a[t+2],s[r+3]=a[t+3]}return o}var Wo=new Uint8Array(new Uint32Array([1]).buffer)[0]===1;function Go(e,t){let n=Uo(e,t/Ho),r=new Uint8Array(n.buffer);if(!Wo){let e=new Uint32Array(n.buffer),t=new DataView(n.buffer);for(let n=0;n<e.length;n++)t.setUint32(n*4,e[n],!0)}return r}function Ko(e){return(!Number.isSafeInteger(e)||e<=0||e>4294967295||e%4!=0)&&z(`integer chunk length must contain complete 32-bit words.`),1+e/4*5}function qo(e,t){let n=Ko(t),r=t/4;(e.length<r+1||e.length>n)&&z(`integer chunk payload length does not match its word count.`);let i=e[0];i!==0&&i!==1&&i!==2&&z(`unsupported integer chunk mode.`);let a=1;for(let t=0;t<r;t++)for(let t=0;;t++){a===e.length&&z(`truncated integer chunk varint.`);let n=e[a++];if(t===4&&n>15&&z(`integer chunk varint exceeds 32 bits.`),!(n&128)){t!==0&&n===0&&z(`noncanonical integer chunk varint.`);break}}a!==e.length&&z(`unexpected trailing integer chunk bytes.`);let o=new Uint8Array(t);a=1;let s=0;for(let t=0;t<r;t++){let n=0,c=0,l;do l=e[a++],n|=(l&127)<<c,c+=7;while(l&128);let u=i===2?n>>>0:(n>>>1^-(n&1))>>>0,d=i===0?u:s+u>>>0;o[t]=d,o[r+t]=d>>>8,o[r*2+t]=d>>>16,o[r*3+t]=d>>>24,s=d}return o}var Jo=1073741823,Yo=!1;function Xo(e){if(!Number.isFinite(e))return 0;let t=Math.round(e*512);return t>Jo||t<-1073741823?(Yo||(Yo=!0,console.warn(`[Parsed data] Position ${e} exceeds the fixed-point range and was clamped.`)),t>0?Jo:-1073741823):t}function Zo(e){return e<0?-e*2-1:e*2}function Qo(e){return e>>>1^-(e&1)}function $o(e,t,n){let r=n-t;if(Math.abs(r)<=1e-20)return 0;let i=((Number.isFinite(e)?e:t)-t)/r;return Math.round((i<0?0:i>1?1:i)*65535)}function es(e,t,n){let r=n-t;return Math.abs(r)<=1e-20?t:t+e/65535*r}var ts=class{data;used=0;constructor(e=1024){this.data=new Uint8Array(Math.max(16,e))}get length(){return this.used}writeByte(e){this.ensureCapacity(1),this.data[this.used++]=e&255}writeUint16(e){this.ensureCapacity(2),this.data[this.used++]=e&255,this.data[this.used++]=e>>>8&255}writeVarUint32(e){this.ensureCapacity(5);let t=e;for(;;){if(t<128){this.data[this.used++]=t;return}this.data[this.used++]=t&127|128,t=Math.floor(t/128)}}writeZigzagVarint(e){this.writeVarUint32(Zo(e))}writeBytes(e){this.ensureCapacity(e.length),this.data.set(e,this.used),this.used+=e.length}writeFloat32(e){this.ensureCapacity(4),new DataView(this.data.buffer,this.data.byteOffset+this.used,4).setFloat32(0,e,!0),this.used+=4}writeFloat64(e){this.ensureCapacity(8),new DataView(this.data.buffer,this.data.byteOffset+this.used,8).setFloat64(0,e,!0),this.used+=8}toUint8Array(){return this.data.slice(0,this.used)}ensureCapacity(e){if(this.used+e<=this.data.length)return;let t=this.data.length*2;for(;this.used+e>t;)t*=2;let n=new Uint8Array(t);n.set(this.data.subarray(0,this.used)),this.data=n}},ns=class{bytes;offset;end;view;constructor(e,t=0,n=e.length){this.bytes=e,this.offset=t,this.end=n,this.view=new DataView(e.buffer,e.byteOffset,e.byteLength)}get byteOffset(){return this.offset}require(e,t){if(this.offset+e>this.end)throw Error(`${t}: varint stream ended early (at ${this.offset}, expected ${this.end}).`)}readByte(e=`byte`){return this.require(1,e),this.bytes[this.offset++]}readFloat32(e=`float32`){this.require(4,e);let t=this.view.getFloat32(this.offset,!0);return this.offset+=4,t}readFloat64(e=`float64`){this.require(8,e);let t=this.view.getFloat64(this.offset,!0);return this.offset+=8,t}readVarUint32(){let e=this.bytes,t=e[this.offset++],n=t&127,r=7;for(;t&128;)t=e[this.offset++],n=r<28?n|(t&127)<<r:(n|(t&15)<<28)>>>0,r+=7;return n>>>0}readZigzagVarint(){return Qo(this.readVarUint32())}expectEnd(e){if(this.offset!==this.end)throw Error(`${e}: varint stream length mismatch (at ${this.offset}, expected ${this.end}).`)}};function rs(e,t,n,r){let i=new Uint8Array(t*5+8),a=0,o=0;for(let s=0;s<t;s+=1){let t=Xo(e[s*n+r]),c=t-o;o=t;let l=c<0?-c*2-1:c*2;for(;;){if(l<128){i[a++]=l;break}i[a++]=l&127|128,l=Math.floor(l/128)}}return i.slice(0,a)}function is(e,t,n,r,i,a,o){let s=t,c=0;for(let t=0;t<i;t+=1){let n=e[s++],i=n&127,l=7;for(;n&128;)n=e[s++],i=l<28?i|(n&127)<<l:(i|(n&15)<<28)>>>0,l+=7;c+=i>>>1^-(i&1),r[t*a+o]=c/512}if(s!==n)throw Error(`Fixed-point delta column length mismatch (at ${s}, expected ${n}).`)}function as(e,t,n,r){let i=new Uint8Array(t*3+8),a=0,o=0;for(let s=0;s<t;s+=1){let t=e[s*n+r],c=t-o;o=t;let l=c<0?-c*2-1:c*2;for(;;){if(l<128){i[a++]=l;break}i[a++]=l&127|128,l=Math.floor(l/128)}}return i.slice(0,a)}function os(e,t,n,r,i,a,o){let s=t,c=0;for(let t=0;t<i;t+=1){let n=e[s++],i=n&127,l=7;for(;n&128;)n=e[s++],i=l<28?i|(n&127)<<l:(i|(n&15)<<28)>>>0,l+=7;c+=i>>>1^-(i&1),r[t*a+o]=c}if(s!==n)throw Error(`Uint16 delta column length mismatch (at ${s}, expected ${n}).`)}var ss=1073741823;function cs(e){return(!Number.isSafeInteger(e)||e<5||e>4294967295)&&z(`path chunk length is invalid.`),e*5+26}function ls(e){z(`path chunk ${e}.`)}var us=class{offset;bytes;end;constructor(e,t=0,n=e.length){this.bytes=e,this.end=n,this.offset=t}byte(){return this.offset>=this.end&&ls(`is truncated`),this.bytes[this.offset++]}uint(){let e=0;for(let t=0;;t++){let n=this.byte();if(t===4&&n>15&&ls(`varint exceeds 32 bits`),e|=(n&127)<<t*7,!(n&128))return t&&n===0&&ls(`has a noncanonical varint`),e>>>0}}signed(){let e=this.uint();return e>>>1^-(e&1)}expectEnd(){this.offset!==this.end&&ls(`has trailing column bytes`)}};function ds(e,t){let n=new us(e),r=n.uint();r*3+4>e.length-n.offset&&ls(`path records are truncated`);let i=0;for(let e=0;e<r;e++){let r=n.signed();(r<-1||r>=e)&&ls(`parent is invalid`),n.byte()>1&&ls(`fill rule is invalid`),i+=n.uint(),i>Math.floor(t/4)&&ls(`edge count exceeds the original payload`)}let a=Array.from({length:4},()=>n.uint());a.some(e=>e<i||e>i*5)&&ls(`coordinate column length is invalid`);let o=n.offset;return o+a.reduce((e,t)=>e+t,0)!==t&&ls(`column lengths do not fill the original section`),{prefixLength:o,edgeCount:i,lengths:a}}function fs(e,t,n){return n.map(n=>{let r=new us(e,t,t+n);return t+=n,r})}function ps(e){(e<-1073741823||e>ss)&&ls(`coordinate is outside the fixed-point range`)}function ms(e){let t=e<0?-e*2-1:e*2;return t<128?1:t<16384?2:t<2097152?3:t<268435456?4:5}function hs(e,t){e.length>cs(t)&&ls(`payload exceeds its original length bound`);let n=new us(e);n.byte()!==0&&ls(`mode is unsupported`);let r=n.uint();(r<5||r>t||r>e.length-n.offset)&&ls(`prefix length is invalid`);let i=e.subarray(n.offset,n.offset+r);n.offset+=r;let a=ds(i,t);a.prefixLength!==r&&ls(`prefix has trailing bytes`);let o=Array.from({length:4},()=>n.uint());(o.some(e=>e<a.edgeCount||e>a.edgeCount*5)||n.offset+o.reduce((e,t)=>e+t,0)!==e.length)&&ls(`chained column lengths are invalid`);let s=n.offset,c=fs(e,s,o),l=[0,0,0,0],u=[0,0,0,0];for(let e=0;e<a.edgeCount;e++){let e=u[2]+c[0].signed(),t=u[3]+c[1].signed(),n=e+c[2].signed(),r=t+c[3].signed();ps(e),ps(t),ps(n),ps(r),l[0]+=ms(e-u[0]),l[1]+=ms(t-u[1]),l[2]+=ms(n-u[2]),l[3]+=ms(r-u[3]),u[0]=e,u[1]=t,u[2]=n,u[3]=r}for(let e of c)e.expectEnd();l.some((e,t)=>e!==a.lengths[t])&&ls(`reconstructed column lengths do not match the original`);let d=new Uint8Array(t);d.set(i);let f=a.lengths.map((e,t)=>r+a.lengths.slice(0,t).reduce((e,t)=>e+t,0)),p=(e,t)=>{let n=t<0?-t*2-1:t*2;for(;n>=128;)d[f[e]++]=n&127|128,n=Math.floor(n/128);d[f[e]++]=n},m=fs(e,s,o);u.fill(0);for(let e=0;e<a.edgeCount;e++){let e=u[2]+m[0].signed(),t=u[3]+m[1].signed(),n=e+m[2].signed(),r=t+m[3].signed();p(0,e-u[0]),p(1,t-u[1]),p(2,n-u[2]),p(3,r-u[3]),u[0]=e,u[1]=t,u[2]=n,u[3]=r}return d}var gs=class{dir=!1;name;uncompressedSize;compression;readBytes;constructor(e,t,n,r){this.name=e,this.uncompressedSize=t,this.readBytes=n,this.compression=r}async async(e){let t=await this.readBytes();if(e===`string`)return Do.decode(t);if(e===`arraybuffer`)return new Uint8Array(t).buffer;if(e===`uint8array`)return new Uint8Array(t);throw Error(`Unsupported HEP section output type: ${String(e)}`)}},_s=class t{files=Object.create(null);file(e,t,n){if(t===void 0)return this.files[e]??null;Fo(e);let r=typeof t==`string`?Eo.encode(t):Ao(t);if(Lo(e,r.length),n?.compression!==void 0&&n.compression!==`STORE`&&n.compression!==`DEFLATE`)throw Error(`HEP section compression must be STORE or DEFLATE.`);return this.files[e]=new gs(e,r.length,async()=>r,n?.compression),this}remove(e){return delete this.files[e],this}static async loadAsync(e,n={}){n.signal?.throwIfAborted();let r=Ao(e);if(Mo(r))throw Error(`Legacy ZIP-based HEP containers are no longer supported. Repack the file with scripts/repack-heps.mjs or regenerate it from the original PDF.`);(!jo(r)||r.length<32)&&z(`missing or truncated HEP header.`);let i=new DataView(r.buffer,r.byteOffset,r.byteLength),a=i.getUint16(4,!0);a!==1&&a!==2&&a!==3&&a!==4&&z(`unsupported container version.`),(i.getUint16(6,!0)!==0||i.getUint32(24,!0)!==0||i.getUint32(28,!0)!==0)&&z(`unsupported header flags or reserved fields.`);let o=i.getUint32(8,!0),s=i.getUint32(12,!0),c=i.getUint32(16,!0),l=32+c;(c%4!=0||l>r.length||c<s*20+o*20)&&z(`invalid index length.`),ko(r.subarray(32,l))!==i.getUint32(20,!0)&&z(`index checksum mismatch.`);let u=[],d=32;for(let e=0;e<s;e+=1){let e={offset:i.getUint32(d,!0),storedLength:i.getUint32(d+4,!0),decodedLength:i.getUint32(d+8,!0),checksum:i.getUint32(d+12,!0),codec:r[d+16],entries:[]};Po(r,d+17,d+20,`chunk reserved fields`),e.codec!==0&&e.codec!==1&&!(a>=2&&e.codec===2)&&!(a>=3&&e.codec===3)&&(a!==4||e.codec!==4)&&z(`unsupported chunk codec.`),e.codec===2&&e.decodedLength%Ho!==0&&z(`palette chunk length must contain complete vec4 items.`),e.codec===3&&Ko(e.decodedLength),e.codec===4&&cs(e.decodedLength),(e.offset%4!=0||e.offset<l||e.storedLength===0||e.offset+e.storedLength>r.length)&&z(`invalid chunk offset or stored length.`),e.decodedLength===0&&z(`invalid decoded chunk length.`),e.codec===0&&e.storedLength!==e.decodedLength&&z(`stored chunk lengths differ.`),u.push(e),d+=20}let f=[],p=new Set;for(let e=0;e<o;e+=1){d+16>l&&z(`truncated section record.`);let e=i.getUint16(d,!0);i.getUint16(d+2,!0)!==0&&z(`nonzero section reserved field.`),(!e||d+16+e>l)&&z(`invalid section name length.`);let t=r.subarray(d+16,d+16+e),a;try{a=Do.decode(t)}catch{z(`invalid UTF-8 section name.`)}Fo(a),p.has(a)&&z(`duplicate section ${a}.`),p.add(a);let o={name:a,nameBytes:t,chunkId:i.getUint32(d+4,!0),offset:i.getUint32(d+8,!0),length:i.getUint32(d+12,!0)};if(Lo(a,o.length,n.entryByteLimits),o.length===0)(o.chunkId!==4294967295||o.offset!==0)&&z(`invalid empty section reference.`);else{let e=u[o.chunkId];(!e||o.offset%4!=0||o.offset+o.length>e.decodedLength)&&z(`invalid section chunk reference or range.`),e.entries.push(o)}f.push(o);let s=No(d+16+e);s>l&&z(`truncated section padding.`),Po(r,d+16+e,s,`section padding`),d=s}d!==l&&z(`unexpected trailing index bytes.`);let m=l;for(let e of[...u].sort((e,t)=>e.offset-t.offset))if(e.offset!==No(m)&&z(`overlapping chunks or unexpected payload gaps.`),Po(r,m,e.offset,`payload alignment padding`),m=e.offset+e.storedLength,e.entries.length===0&&z(`unreferenced chunk.`),e.entries.sort((e,t)=>e.offset-t.offset),e.entries.length===1){let t=e.entries[0];(t.offset!==0||t.length!==e.decodedLength)&&z(`standalone section must cover its complete chunk.`)}else{let t=Bo(e.entries[0].name);(t===void 0||e.decodedLength>65536)&&z(`invalid grouped chunk.`);let n=0;for(let r of e.entries)(r.length>4096||Bo(r.name)!==t||Vo(r.name)||r.offset!==No(n))&&z(`overlapping sections or invalid grouped section layout.`),n=r.offset+r.length;n!==e.decodedLength&&z(`unexpected trailing grouped bytes.`)}r.length!==No(m)&&z(`unexpected or truncated trailing payload bytes.`),Po(r,m,r.length,`final payload padding`);let h=new Map,g=async e=>{n.signal?.throwIfAborted();let t=r.subarray(e.offset,e.offset+e.storedLength),i=e.codec===3?Ko(e.decodedLength):e.codec===4?cs(e.decodedLength):e.decodedLength,a=e.codec===0?t:await Ro(t,!1,i,n.signal),o=e.codec===2?Go(a,e.decodedLength):e.codec===3?qo(a,e.decodedLength):e.codec===4?hs(a,e.decodedLength):a;n.signal?.throwIfAborted(),o.length!==e.decodedLength&&z(`decoded chunk length mismatch.`),ko(o)!==e.checksum&&z(`chunk checksum mismatch.`);let s=0;for(let t of e.entries)Po(o,s,t.offset,`group alignment padding`),s=t.offset+t.length;return o},_=new t;for(let e of f)_.files[e.name]=new gs(e.name,e.length,async()=>{if(n.signal?.throwIfAborted(),e.chunkId===4294967295)return new Uint8Array;let t=u[e.chunkId],r;if(t.entries.length>1){let n=h.get(e.chunkId);n||(n=g(t),h.set(e.chunkId,n)),r=await n}else r=await g(t);return n.signal?.throwIfAborted(),r.subarray(e.offset,e.offset+e.length)});return _}async generateAsync(t,n){if(t.signal?.throwIfAborted(),`compressionLevel`in t||`compressionOptions`in t)throw Error(`HEP native compression does not support compressionLevel or compressionOptions; use compression: DEFLATE or STORE.`);let r=t.compression??`DEFLATE`;if(r!==`DEFLATE`&&r!==`STORE`)throw Error(`HEP compression must be DEFLATE or STORE.`);if(t.type!==`blob`&&t.type!==`uint8array`&&t.type!==`arraybuffer`)throw Error(`Unsupported HEP output type: ${String(t.type)}`);n?.({percent:0});let i=Object.values(this.files),{generateHepArchive:a}=await m(e(()=>import(`./hepContainerWriter-BujvV9Rr.js`),__vite__mapDeps([10,11]),import.meta.url),t.signal);return t.signal?.throwIfAborted(),a(i,t,r,n)}},vs=e=>new Uint32Array(e.buffer,e.byteOffset,e.length);async function ys(e,t,n){if(n?.throwIfAborted(),t.pointRecipes||!t.origins||t.literals.segmentCount===0)return t;Ts(t,e,!1);let r=t.literals.segmentCount,i=[new Uint32Array(r),new Uint32Array(r)],a=[vs(e.endpoints),vs(e.primitiveMeta)],o=t.positionQuanta!==void 0||t.positionQuantum!==void 0,s=performance.now(),c=async()=>{n?.throwIfAborted(),!(performance.now()-s<50)&&(await new Promise(e=>globalThis.setTimeout(e,0)),n?.throwIfAborted(),s=performance.now())},l=new Map;for(let e=0;e<r;e++){let n=o?ws(t,e):0,r=l.get(n);r?r.push(e):l.set(n,[e])}for(let[s,u]of l){n?.throwIfAborted();let l=await Cs(e,a,o,s,c);for(let n of u){n&4095||await c();for(let c=0;c<2;c++){let u=c===0?`endpoints`:`primitiveMeta`,d=t.origins[n],f=d*4,p=c===0?e.endpoints:e.primitiveMeta,m=o?Math.round(p[f]/s)|0:a[c][f],h=o?Math.round(p[f+1]/s)|0:a[c][f+1],g=o?t.literals[u][n]+m|0:(t.literals[u][n]^m)>>>0,_=o?t.literals[u][r+n]+h|0:(t.literals[u][r+n]^h)>>>0,v=d*2+c,y=l.find(g|0,_|0);if(y<0)continue;let b=(g===m&&_===h?v:l.closest(y,v))-v,x=b>=0?b*2+1:-b*2;Number.isSafeInteger(x)&&x<=4294967295&&(i[c][n]=x)}}}let u=i.map((e,n)=>{let i=0;for(let t of e)t===0&&i++;let a=new Uint32Array(i*2),o=n===0?`endpoints`:`primitiveMeta`,s=0;for(let n=0;n<r;n++)e[n]===0&&(a[s]=t.literals[o][n],a[i+s++]=t.literals[o][r+n]);return{references:e,residuals:a}}),d={...t,literals:{...t.literals,endpoints:t.literals.endpoints.slice(r*2),primitiveMeta:t.literals.primitiveMeta.slice(r*2)},pointRecipes:{version:1,start:u[0],end:u[1]}},f=[d.literals.endpoints,d.literals.primitiveMeta,...u.flatMap(e=>[e.references,e.residuals])].every(e=>e.byteLength>zo),p=await Ss(f?bs(t):t,n);return await Ss(f?bs(d):d,n)<p?d:t}function bs(e){return{literals:{endpoints:e.literals.endpoints,primitiveMeta:e.literals.primitiveMeta},...e.pointRecipes?{pointRecipes:e.pointRecipes}:{}}}function xs(e,t){if(t.pointRecipes===void 0)return t;Ts(t,e,!0);let n=t.literals.segmentCount,r=t.positionQuanta!==void 0||t.positionQuantum!==void 0,i=[vs(e.endpoints),vs(e.primitiveMeta)],a=[];for(let o=0;o<2;o++){let s=o===0?`endpoints`:`primitiveMeta`,c=o===0?t.pointRecipes.start:t.pointRecipes.end,l=c.residuals.length/2,u=new Uint32Array(n*4);u.set(t.literals[s],n*2);let d=0;for(let a=0;a<n;a++){let s=c.references[a];if(s===0){u[a]=c.residuals[d],u[n+a]=c.residuals[l+d++];continue}let f=s-1,p=f%2?-(f+1)/2:f/2,m=t.origins[a]*2+o+p,h=m%2==0?e.endpoints:e.primitiveMeta,g=Math.floor(m/2)*4,_=o===0?e.endpoints:e.primitiveMeta,v=t.origins[a]*4;for(let e=0;e<2;e++)u[e*n+a]=r?(Math.round(h[g+e]/ws(t,a))|0)-(Math.round(_[v+e]/ws(t,a))|0)>>>0:i[m%2][g+e]^i[o][v+e]}a.push(u)}let{pointRecipes:o,...s}=t;return{...s,literals:{...t.literals,endpoints:a[0],primitiveMeta:a[1]}}}async function Ss(e,t){let n=new _s,r=0,i=JSON.stringify(e,(e,i)=>{if(!(i instanceof Uint32Array||i instanceof Float32Array||i instanceof Float64Array))return i;t?.throwIfAborted();let a=`lod-vector/${r++}.bin`,o=i.BYTES_PER_ELEMENT,s=new Uint8Array(i.byteLength),c=new DataView(new ArrayBuffer(o));for(let e=0;e<i.length;e++){e&4095||t?.throwIfAborted(),i instanceof Float64Array?c.setFloat64(0,i[e],!0):i instanceof Float32Array?c.setFloat32(0,i[e],!0):c.setUint32(0,i[e],!0);for(let t=0;t<o;t++)s[t*i.length+e]=c.getUint8(t)}return n.file(a,s),{array:i instanceof Float64Array?`f64`:i instanceof Float32Array?`f32`:`u32`,file:a,length:i.length}});return n.file(`lod-vector/index.json`,i),(await n.generateAsync({type:`uint8array`,compression:`DEFLATE`,signal:t})).byteLength}async function Cs(e,t,n,r,i){let a=e.segmentCount*2,o=1;for(;o<a*2;)o*=2;let s=o-1,c=new Int32Array(o).fill(-1),l=new Int32Array(a),u=new Int32Array(a),d=new Int32Array(a+1),f=new Int32Array(a),p=0,m=(e,t)=>{let n=(Math.imul(e,2654435761)^Math.imul(t^t>>>16,2246822507))>>>0;for(n=(n^n>>>15)&s;c[n]>=0&&(l[c[n]]!==e||u[c[n]]!==t);)n=n+1&s;return n};for(let a=0;a<e.segmentCount;a++){a&4095||await i();for(let i=0;i<2;i++){let o=i===0?e.endpoints:e.primitiveMeta,s=a*4,h=n?Math.round(o[s]/r)|0:t[i][s]|0,g=n?Math.round(o[s+1]/r)|0:t[i][s+1]|0,_=m(h,g);c[_]<0&&(c[_]=p,l[p]=h,u[p++]=g),f[a*2+i]=c[_],d[c[_]+1]++}}for(let e=0;e<p;e++)d[e+1]+=d[e];let h=new Int32Array(a),g=d.slice(0,p);for(let e=0;e<a;e++)h[g[f[e]]++]=e;return{find(e,t){return c[m(e,t)]},closest(e,t){let n=d[e],r=d[e+1],i=n,a=r;for(;i<a;){let e=i+a>>>1;h[e]<t?i=e+1:a=e}return i===n?h[n]:i===r?h[r-1]:t-h[i-1]<=h[i]-t?h[i-1]:h[i]}}}function ws(e,t){return e.positionQuanta?.[t]??e.positionQuantum}function Ts(e,t,n){let r=e?.literals?.segmentCount;Es(Number.isSafeInteger(r)&&r>=0&&r<=1073741823),Es(Number.isSafeInteger(t.segmentCount)&&t.segmentCount>0&&t.segmentCount<=1073741823),Es(t.endpoints instanceof Float32Array&&t.endpoints.length>=t.segmentCount*4&&t.primitiveMeta instanceof Float32Array&&t.primitiveMeta.length>=t.segmentCount*4),Es(e.origins instanceof Uint32Array&&e.origins.length===r&&e.origins.every(e=>e<t.segmentCount)),Es(e.positionQuantum===void 0||e.positionQuantum===1/512),e.positionQuanta!==void 0&&Es(e.positionQuantum===void 0&&e.positionQuanta instanceof Float32Array&&e.positionQuanta.length===r&&e.positionQuanta.every(e=>Number.isFinite(e)&&e>0&&Number.isInteger(Math.log2(e))));for(let t of[`endpoints`,`primitiveMeta`])Es(e.literals[t]instanceof Uint32Array&&e.literals[t].length===r*(n?2:4));if(n){Es(e.pointRecipes?.version===1);for(let[n,i]of[e.pointRecipes.start,e.pointRecipes.end].entries()){Es(i&&i.references instanceof Uint32Array&&i.references.length===r&&i.residuals instanceof Uint32Array);let a=0;for(let o=0;o<r;o++){let r=i.references[o];if(r===0){a++;continue}let s=r-1,c=s%2?-(s+1)/2:s/2,l=e.origins[o]*2+n+c;Es(Number.isSafeInteger(l)&&l>=0&&l<t.segmentCount*2)}Es(i.residuals.length===a*2)}}}function Es(e){if(!e)throw Error(`invalid vector LOD point recipe`)}var Ds=1/512;function Os(e){if(e.positionQuanta)return e;let t=e.literals.segmentCount,n=new Float32Array(t).fill(1/0),r=e.levels[0].segmentCount;for(let t of e.levels){let e=2**Math.floor(Math.log2(t.tolerance/32));if(e>0)for(let i of t.records??[])i>=r&&(n[i-r]=Math.min(n[i-r],e))}let i=e.literals.endpoints.slice(),a=e.literals.primitiveMeta.slice(),o=e.literals.primitiveBounds.slice();for(let r=0;r<t;r++){Number.isFinite(n[r])||(n[r]=Ds);let t=n[r];for(let n of[i,a])for(let i=0;i<(n===a?2:4);i++){let a=r*4+i,o=Math.round(n[a]/t);if(!Number.isSafeInteger(o)||o<-2147483648||o>2147483647)return console.warn(`[HEP] Compact vector LOD coordinates exceed the integer range; keeping existing LOD geometry.`),e;n[a]=o===0?0:o*t}let s=r*4;if(!(Math.floor(a[s+3]/2+1e-6)&4))for(let e=0;e<2;e++)o[s+e]=Math.min(i[s+e],i[s+e+2],a[s+e]),o[s+e+2]=Math.max(i[s+e],i[s+e+2],a[s+e])}let{positionQuantum:s,...c}=e;return{...c,positionQuanta:n,literals:{...e.literals,endpoints:i,primitiveMeta:a,primitiveBounds:o},levels:e.levels.map((e,t)=>{if(t===0)return e;let i=0;for(let t of e.records??[])t>=r&&(i=Math.max(i,n[t-r]/2));return{...e,tolerance:e.tolerance+Math.SQRT2*i,sceneBounds:{minX:e.sceneBounds.minX-i,minY:e.sceneBounds.minY-i,maxX:e.sceneBounds.maxX+i,maxY:e.sceneBounds.maxY+i}}})}}function ks(e){let t=e.literals.segmentCount,n=e.levels[0].segmentCount,r=js.map(t=>Vs(e.literals[t])),i=new Map,a=new Int32Array(t).fill(-1),o=new Uint32Array(t),s=[];for(let n=0;n<t;n++){let t=2166136261;for(let e of r)for(let r=0;r<4;r++)t=Math.imul(t^e[n*4+r],16777619);t=Math.imul(t^(e.origins?.[n]??0),16777619);let c=-1;for(let o=i.get(t)??-1;o>=0;o=a[o])if(e.origins?.[n]===e.origins?.[o]&&r.every(e=>e[n*4]===e[o*4]&&e[n*4+1]===e[o*4+1]&&e[n*4+2]===e[o*4+2]&&e[n*4+3]===e[o*4+3])){c=o;break}c>=0?o[n]=o[c]:(o[n]=s.length,s.push(n),a[n]=i.get(t)??-1,i.set(t,n))}if(s.length===t)return e;let c={segmentCount:s.length};js.forEach((e,t)=>{let n=new Uint32Array(s.length*4);s.forEach((e,i)=>n.set(r[t].subarray(e*4,e*4+4),i*4)),c[e]=new Float32Array(n.buffer)});let l={...e,literals:c,levels:e.levels.map(e=>e.records?{...e,records:e.records.map(e=>e<n?e:n+o[e-n])}:e)};if(e.origins&&(l.origins=Uint32Array.from(s,t=>e.origins[t])),e.positionQuanta){l.positionQuanta=new Float32Array(s.length).fill(1/0);for(let n=0;n<t;n++)l.positionQuanta[o[n]]=Math.min(l.positionQuanta[o[n]],e.positionQuanta[n])}return l}function As(e,t=!1){let n=ks(e);return t?ks(Os(n)):n}var js=[`endpoints`,`primitiveMeta`,`primitiveBounds`,`styles`];function Ms(e,t,n=!1){let r=t.literals.segmentCount,i={segmentCount:r};for(let n of js){let a=Vs(t.literals[n]),o=Vs(e[n]),s=new Uint32Array(a.length),c=n===`endpoints`?Vs(t.literals.primitiveMeta):void 0;for(let i=0;i<r;i++)for(let l=0;l<4;l++)s[l*r+i]=Is(t,n,l)?Math.round(t.literals[n][i*4+l]/Fs(t,i))-Ls(e,t,n,i,l)>>>0:a[i*4+l]^Bs(n,i,l,o,t,c);i[n]=s}return{...t,literals:i,...n?{}:{tileIndexes:`rebuild`},levels:n?t.levels:t.levels.map(({tileOffsets:e,tileCounts:t,tileSegmentIds:n,...r})=>r)}}function Ns(e,t){t=xs(e,t);let n=t?.literals?.segmentCount;rc(t.positionQuantum===void 0||t.positionQuantum===.001953125),rc(Number.isSafeInteger(n)&&n>=0&&n<=1073741823),t.positionQuanta!==void 0&&rc(t.positionQuantum===void 0&&t.positionQuanta instanceof Float32Array&&t.positionQuanta.length===n&&t.positionQuanta.every(e=>Number.isFinite(e)&&e>0&&Number.isInteger(Math.log2(e)))),t.origins!==void 0&&rc(t.origins instanceof Uint32Array&&t.origins.length===n&&t.origins.every(t=>t<e.segmentCount));for(let e of js)rc(t.literals[e]instanceof Uint32Array&&t.literals[e].length===n*4);let{tileIndexes:r,...i}=t,a={...i,levels:t.levels.map(e=>({...e,tileOffsets:e.tileOffsets??new Uint32Array,tileCounts:e.tileCounts??new Uint32Array,tileSegmentIds:e.tileSegmentIds??new Uint32Array})),literals:{segmentCount:n}};for(let r of[`primitiveMeta`,`endpoints`,`primitiveBounds`,`styles`]){let i=t.literals[r],o=Vs(e[r]),s=new Uint32Array(n*4),c=r===`endpoints`?Vs(a.literals.primitiveMeta):void 0;for(let t=0;t<n;t++)for(let l=0;l<4;l++)Is(a,r,l)?(Rs[0]=(i[l*n+t]+Ls(e,a,r,t,l)|0)*Fs(a,t),s[t*4+l]=zs[0]):s[t*4+l]=i[l*n+t]^Bs(r,t,l,o,a,c);a.literals[r]=new Float32Array(s.buffer)}return a}async function Ps(e,t,n){return ys(e,t,n)}function Fs(e,t){return e.positionQuanta?.[t]??e.positionQuantum}function Is(e,t,n){return(e.positionQuantum!==void 0||e.positionQuanta!==void 0)&&(t===`endpoints`||t===`primitiveMeta`&&n<2)}function Ls(e,t,n,r,i){let a=n===`endpoints`&&i>=2?t.literals.primitiveMeta[r*4+i-2]:t.origins?e[n][t.origins[r]*4+i]:0;return Math.round(a/Fs(t,r))|0}var Rs=new Float32Array(1),zs=new Uint32Array(Rs.buffer);function Bs(e,t,n,r,i,a){let o=t*4;if(e===`endpoints`&&n>=2)return a[o+n-2];if(e===`primitiveBounds`){let e=n%2,t=i.literals.endpoints[o+e],r=i.literals.primitiveMeta[o+e];return Rs[0]=n<2?Math.min(t,r):Math.max(t,r),zs[0]}return i.origins?r[i.origins[t]*4+n]:0}function Vs(e){return new Uint32Array(e.buffer,e.byteOffset,e.length)}var Hs=[`bounds.minX`,`bounds.minY`,`bounds.maxX`,`bounds.maxY`],Us=[`inkHeightDirection.0`,`inkHeightDirection.1`,`baselineDirection.0`,`baselineDirection.1`],Ws={runs:[`exactStart`,`exactCount`,`coarseIndex`,`pageIndex`,...Hs,...Array.from({length:6},(e,t)=>`transform.${t}`),`maxInkHeight`,`eligible`],clusters:[`pageIndex`,`runStart`,`runCount`,`exactStart`,`exactCount`,`coarseStart`,`coarseCount`,...Hs,`maxInkHeight`,...Us,`eligible`],pages:[`pageIndex`,`clusterStart`,`clusterCount`,`exactStart`,`exactCount`,`coarseCount`,...Hs,`maxInkHeight`,...Us,`eligible`]},Gs=[`coarseInstanceA`,`coarseInstanceB`,`coarseInstanceC`],Ks=new DataView(new ArrayBuffer(8));function qs(e){Number.isNaN(e)?(Ks.setUint32(0,0,!0),Ks.setUint32(4,2146959360,!0)):Ks.setFloat64(0,e,!0)}function Js(e,t){let[n,r]=t.split(`.`),i=r===void 0?e[n]:e[n]?.[r];return i===void 0?NaN:Number(i)}function Ys(e,t,n){let r={...e,textEncoding:`predictive`};for(let i of[`runs`,`clusters`,`pages`]){let a=e[i],o=Ws[i],s=new Uint32Array(a.length*o.length*2);for(let r=0;r<a.length;r++){let c=a[r];n?.throwIfAborted();let l=ec(t,e,i,c,r,n);o.forEach((e,t)=>{qs(Js(l,e));let n=Ks.getUint32(0,!0),i=Ks.getUint32(4,!0);qs(Js(c,e)),s[t*2*a.length+r]=Ks.getUint32(0,!0)^n,s[(t*2+1)*a.length+r]=Ks.getUint32(4,!0)^i})}r[i]={count:a.length,columns:s}}let i=nc(t,e,n);return Gs.forEach((t,n)=>{let a=Vs(e[t]),o=Vs(i[n]),s=new Uint32Array(a.length);for(let t=0;t<e.coarseInstanceCount;t++)for(let n=0;n<4;n++)s[n*e.coarseInstanceCount+t]=a[t*4+n]^o[t*4+n];r[t]=s}),r}function Xs(e,t,n){let r=e.textEncoding===`predictive`;if(rc(e.textEncoding===void 0||r),r){rc(t&&e.exactInstanceCount===t.textInstanceCount&&Number.isSafeInteger(e.coarseInstanceCount)&&e.coarseInstanceCount>=0&&e.coarseInstanceCount<=e.exactInstanceCount&&e.combinedInstanceCount===e.exactInstanceCount+e.coarseInstanceCount&&e.solidGlyphIndex===t.textGlyphCount);for(let t of Gs)rc(e[t]instanceof Uint32Array&&e[t].length===e.coarseInstanceCount*4)}let{textEncoding:i,...a}=e,o={...a};for(let i of[`runs`,`clusters`,`pages`]){let a=e?.[i],s=Ws[i];rc(a&&Number.isSafeInteger(a.count)&&a.count>=0&&a.count<=e.exactInstanceCount+4096&&(r?a.columns instanceof Uint32Array:a.columns instanceof Float64Array)&&a.columns.length===a.count*s.length*(r?2:1)),r&&rc(a.count<=(i===`runs`?e.exactInstanceCount:i===`clusters`?o.runs.length:t.pageCount)),r&&i===`pages`&&rc(a.count===t.pageCount);let c=[];o[i]=c;let l=i===`runs`?[0,1,2]:[1,2];for(let e=0;e<a.count;e++){n?.throwIfAborted();let u={},d=(t,n)=>{let i=s[t],o=a.columns[t*a.count+e];if(r){qs(Js(n,i));let r=Ks.getUint32(0,!0),s=Ks.getUint32(4,!0);Ks.setUint32(0,a.columns[t*2*a.count+e]^r,!0),Ks.setUint32(4,a.columns[(t*2+1)*a.count+e]^s,!0),o=Ks.getFloat64(0,!0)}Zs(u,i,o)};if(r){let r=Qs(o,i,e);l.forEach(e=>d(e,r)),$s(o,i,u);let a=ec(t,o,i,u,e,n);if(i===`runs`){for(let e=8;e<14;e++)d(e,a);a.bounds=tc(u.transform);for(let e of[3,4,5,6,7,14,15])d(e,a)}else s.forEach((e,t)=>{l.includes(t)||d(t,a)})}else s.forEach((e,t)=>d(t,{}));c.push(u)}}if(r){let r=nc(t,o,n);Gs.forEach((t,n)=>{let i=e[t];rc(i instanceof Uint32Array&&i.length===e.coarseInstanceCount*4);let a=Vs(r[n]);for(let t=0;t<e.coarseInstanceCount;t++)for(let n=0;n<4;n++)a[t*4+n]^=i[n*e.coarseInstanceCount+t];o[t]=r[n]})}return o}function Zs(e,t,n){let[r,i]=t.split(`.`);if(r===`inkHeightDirection`||r===`baselineDirection`){if(Number.isNaN(n)){rc(e[r]===void 0),e[r]=void 0;return}i===`1`&&rc(e[r]!==void 0)}if(rc(Number.isFinite(n)||r===`maxInkHeight`&&n===1/0),r===`eligible`)rc(n===0||n===1),e[r]=n===1;else if(i===void 0)e[r]=n;else{let t=e[r]??=r===`bounds`?{}:[];t[i]=n}}function Qs(e,t,n){let r=e[t][n-1];return{exactStart:r?Number(r.exactStart)+Number(r.exactCount):0,exactCount:0,coarseIndex:0,runStart:r?Number(r.runStart)+Number(r.runCount):0,runCount:0,clusterStart:r?Number(r.clusterStart)+Number(r.clusterCount):0,clusterCount:0}}function $s(e,t,n){let r=Number(n[t===`runs`?`exactStart`:t===`clusters`?`runStart`:`clusterStart`]),i=Number(n[t===`runs`?`exactCount`:t===`clusters`?`runCount`:`clusterCount`]),a=t===`runs`?e.exactInstanceCount:t===`clusters`?e.runs.length:e.clusters.length;rc(Number.isSafeInteger(r)&&r>=0&&Number.isSafeInteger(i)&&i>=0&&r+i<=a);let o=e[t],s=o[o.length-1];rc(r===(s?Number(s[t===`runs`?`exactStart`:t===`clusters`?`runStart`:`clusterStart`])+Number(s[t===`runs`?`exactCount`:t===`clusters`?`runCount`:`clusterCount`]):0)&&(t===`pages`||i>0)),t===`runs`&&rc(Number.isSafeInteger(n.coarseIndex)&&Number(n.coarseIndex)>=-1&&Number(n.coarseIndex)<e.coarseInstanceCount)}function ec(e,t,n,r,i,a){let o=Object.fromEntries(Ws[n].filter(e=>!e.includes(`.`)).map(e=>[e,0]));if(Object.assign(o,Qs(t,n,i)),n===`runs`){let t=[0,0,0,0,0,0],n=1/0;if(Number(r.coarseIndex)>=0){let i=Number(r.exactStart),o=i+Number(r.exactCount),s=i*4,c=e.textInstanceA[s],l=e.textInstanceA[s+1],u=e.textInstanceA[s+2],d=e.textInstanceA[s+3],f=e.textInstanceB[s],p=e.textInstanceB[s+1],m=1/(c*d-l*u),h=1/0,g=1/0,_=-1/0,v=-1/0;n=0;for(let t=i;t<o;t++){t&4095||a?.throwIfAborted();let r=t*4,o=Math.trunc(e.textInstanceB[r+2])*4,s=e.textInstanceB[r]-f,y=e.textInstanceB[r+1]-p,b=t===i?0:(d*s-u*y)*m,x=t===i?0:(c*y-l*s)*m,S=e.textGlyphMetaA[o+2],C=e.textGlyphMetaA[o+3],w=e.textGlyphMetaB[o],T=e.textGlyphMetaB[o+1];h=Math.min(h,t===i?S:S+b),g=Math.min(g,t===i?C:C+x),_=Math.max(_,t===i?w:w+b),v=Math.max(v,t===i?T:T+x),n=Math.max(n,(T-C)*(Math.abs(e.textInstanceA[r+2])+Math.abs(e.textInstanceA[r+3])))}let y=_-h,b=v-g;t.splice(0,6,c*y,l*y,u*b,d*b,c*h+u*g+f,l*h+d*g+p)}o.transform=t,o.bounds=tc(r.transform??t),o.maxInkHeight=n,o.eligible=Number(r.coarseIndex)>=0}else{let a=n===`clusters`?t.runs:t.clusters,s=Number(r[n===`clusters`?`runStart`:`clusterStart`]),c=s+Number(r[n===`clusters`?`runCount`:`clusterCount`]),l=a[s];o.pageIndex=n===`pages`?i:l?.pageIndex??0,o.exactStart=l?.exactStart??o.exactStart,o.exactCount=0,o.coarseStart=l&&`coarseIndex`in l?l.coarseIndex:-1,o.coarseCount=0,o.maxInkHeight=0,o.eligible=c>s;let u;if(n===`pages`){let t=i*4;u={minX:Math.min(e.pageRects[t],e.pageRects[t+2]),minY:Math.min(e.pageRects[t+1],e.pageRects[t+3]),maxX:Math.max(e.pageRects[t],e.pageRects[t+2]),maxY:Math.max(e.pageRects[t+1],e.pageRects[t+3])},Object.values(u).every(Number.isFinite)||(u={...e.bounds}),o.exactStart=e.pageTextRanges[i*2],o.exactCount=e.pageTextRanges[i*2+1]}for(let e=s;e<c;e++){let t=a[e];n===`clusters`&&(o.exactCount=Number(o.exactCount)+t.exactCount),o.coarseCount=Number(o.coarseCount)+(`coarseIndex`in t?Number(t.eligible):t.coarseCount),o.maxInkHeight=Math.max(Number(o.maxInkHeight),t.maxInkHeight),o.eligible=!!o.eligible&&t.eligible,u=u?{minX:Math.min(u.minX,t.bounds.minX),minY:Math.min(u.minY,t.bounds.minY),maxX:Math.max(u.maxX,t.bounds.maxX),maxY:Math.max(u.maxY,t.bounds.maxY)}:{...t.bounds}}o.bounds=u??{minX:0,minY:0,maxX:0,maxY:0}}return o}function tc(e){let[t,n,r,i,a,o]=e;return{minX:Math.min(a,t+a,r+a,t+r+a),minY:Math.min(o,n+o,i+o,n+i+o),maxX:Math.max(a,t+a,r+a,t+r+a),maxY:Math.max(o,n+o,i+o,n+i+o)}}function nc(e,t,n){let r=Gs.map(()=>new Float32Array(t.coarseInstanceCount*4));for(let i of t.runs)if(i.coarseIndex>=0){n?.throwIfAborted();let a=i.coarseIndex*4;rc(i.coarseIndex<t.coarseInstanceCount),r[0].set(i.transform.slice(0,4),a),r[1].set([i.transform[4],i.transform[5],0,0],a),r[2].set(e.textInstanceC.subarray(i.exactStart*4,i.exactStart*4+4),a)}return r}function rc(e){if(!e)throw Error(`invalid compact LOD encoding`)}var ic=1,ac=720,oc=Math.PI/ac,sc=12,cc=15,lc=4096,uc=4095,dc=class{tuple;size=0;arity;keys;keySlots;slots;pendingSlot=-1;hashValue=new Float64Array(1);hashWords=new Uint32Array(this.hashValue.buffer);constructor(e,t=1024){this.arity=e,this.tuple=new Float64Array(e),this.keys=new Float64Array(t*e),this.keySlots=new Int32Array(t),this.slots=new Int32Array(t*2)}find(){let e=this.slots.length-1;for(let t=this.hash(this.tuple,0)&e;;t=t+1&e){let e=this.slots[t]-1;if(e<0)return this.pendingSlot=t,-1;if(this.matches(e))return e}}insert(){this.size===this.keySlots.length&&this.growEntries();let e=this.size++;return this.keys.set(this.tuple,e*this.arity),this.keySlots[e]=this.pendingSlot,this.slots[this.pendingSlot]=e+1,this.pendingSlot=-1,this.size*2>this.slots.length&&this.rehash(this.slots.length*2),e}clear(){for(let e=0;e<this.size;e++)this.slots[this.keySlots[e]]=0;this.size=0,this.pendingSlot=-1}matches(e){let t=e*this.arity;for(let e=0;e<this.arity;e++){let n=this.keys[t+e],r=this.tuple[e];if(n!==r&&(n===n||r===r))return!1}return!0}hash(e,t){let n=2166136261;for(let r=0;r<this.arity;r++){let i=e[t+r],a=0,o=2146959360;i===i&&i!==0?(this.hashValue[0]=i,a=this.hashWords[0],o=this.hashWords[1]):i===0&&(o=0),n=Math.imul(n^a,16777619),n=Math.imul(n^o,16777619)}return n^=n>>>16,Math.imul(n,2146121005)>>>0}growEntries(){let e=new Float64Array(this.keys.length*2);e.set(this.keys),this.keys=e;let t=new Int32Array(this.keySlots.length*2);t.set(this.keySlots),this.keySlots=t}rehash(e){this.slots=new Int32Array(e);let t=e-1;for(let e=0;e<this.size;e++){let n=this.hash(this.keys,e*this.arity)&t;for(;this.slots[n]!==0;)n=n+1&t;this.slots[n]=e+1,this.keySlots[e]=n}}},fc=class{pages=[];width;length=0;constructor(e){this.width=e}append(e,t,n=0){let r=this.length++,i=r>>>sc,a=this.pages[i]??(this.pages[i]=new Uint32Array(lc*this.width)),o=(r&uc)*this.width;return a[o]=e,a[o+1]=t,this.width===3&&(a[o+2]=n),r}get(e,t){return this.pages[e>>>sc][(e&uc)*this.width+t]}set(e,t,n){this.pages[e>>>sc][(e&uc)*this.width+t]=n}clear(){this.length=0,this.pages.length>1&&(this.pages.length=1)}},pc=class{groupIds=new dc(cc);groups=new fc(3);members=new fc(2);tolerance;overview;readPrimitive;constructor(e,t,n){this.tolerance=e,this.overview=t,this.readPrimitive=n}get size(){return this.groups.length}add(e,t,n){mc(this.groupIds.tuple,e,n,this.tolerance,this.overview);let r=this.groupIds.find(),i=this.members.append(t,0);r<0?(r=this.groups.append(i+1,i+1,n),this.groupIds.insert()):(this.members.set(this.groups.get(r,1)-1,1,i+1),this.groups.set(r,1,i+1))}*values(){for(let e=0;e<this.groups.length;e++){let t=this.groups.get(e,2),n=this.groups.get(e,0),r;for(;n!==0;){let e=n-1,i=this.readPrimitive(this.members.get(e,0));if(!i)throw Error(`LOD interval source changed during construction`);r??=hc(i,t,this.tolerance,this.overview);let a=i.x1-i.x0,o=i.y1-i.y0,s=i.x0*r.normalX+i.y0*r.normalY,c=Math.hypot(a,o);r.offsetSum+=s*c,r.offsetWeightSum+=c;let l=i.visibleBounds;l&&(r.clipMinX=Math.min(r.clipMinX,l.minX),r.clipMinY=Math.min(r.clipMinY,l.minY),r.clipMaxX=Math.max(r.clipMaxX,l.maxX),r.clipMaxY=Math.max(r.clipMaxY,l.maxY)),gc(r,i,this.tolerance),n=this.members.get(e,1)}r&&(yield r)}}clear(){this.groupIds.clear(),this.groups.clear(),this.members.clear()}};function mc(e,t,n,r,i){let a=t.x1-t.x0,o=t.y1-t.y0,s=Math.atan2(o,a);s<0&&(s+=Math.PI),s>=Math.PI&&(s-=Math.PI);let c=Math.round(s/oc);c>=ac&&(c=0);let l=c*oc,u=Math.cos(l),d=-Math.sin(l),f=u,p=t.x0*d+t.y0*f,m=(t.flags&ic)!==0,h=!i&&!m&&t.halfWidth>0?Math.min(r,t.halfWidth*.02):r,g=Math.round(p/h),_=m?-1:t.halfWidth,v=t.flags&7,y=t.visibleBounds;e[0]=t.paintGroup??-1,e[1]=n,e[2]=v,e[3]=_,e[4]=Math.round(t.colorR*255),e[5]=Math.round(t.colorG*255),e[6]=Math.round(t.colorB*255),e[7]=Math.round(t.alpha*255),e[8]=c,e[9]=g,e[10]=+!!y,e[11]=y?y.minX:0,e[12]=y?y.minY:0,e[13]=y?y.maxX:0,e[14]=y?y.maxY:0}function hc(e,t,n,r){let i=e.x1-e.x0,a=e.y1-e.y0,o=Math.atan2(a,i);o<0&&(o+=Math.PI),o>=Math.PI&&(o-=Math.PI);let s=Math.round(o/oc);s>=ac&&(s=0);let c=s*oc,l=Math.cos(c),u=Math.sin(c),d=-u,f=l,p=e.x0*d+e.y0*f,m=(e.flags&ic)!==0,h=!r&&!m&&e.halfWidth>0?Math.min(n,e.halfWidth*.02):n,g=Math.round(p/h),_=e.flags&7;return{paintOrder:e.paintOrder,paintGroup:e.paintGroup,tileIndex:t,axisX:l,axisY:u,normalX:d,normalY:f,offset:g*h,offsetSum:0,offsetWeightSum:0,clipMinX:1/0,clipMinY:1/0,clipMaxX:-1/0,clipMaxY:-1/0,halfWidth:e.halfWidth,flags:_,alpha:e.alpha,colorR:e.colorR,colorG:e.colorG,colorB:e.colorB,intervals:[]}}function gc(e,t,n){let r=t.x0*e.axisX+t.y0*e.axisY,i=t.x1*e.axisX+t.y1*e.axisY,a=Math.min(r,i),o=Math.max(r,i),s=t.visibleBounds;if(s){let r=s.minX*e.axisX+s.minY*e.axisY,i=s.minX*e.axisX+s.maxY*e.axisY,c=s.maxX*e.axisX+s.minY*e.axisY,l=s.maxX*e.axisX+s.maxY*e.axisY,u=Math.max(t.halfWidth*4,n,.001);if(a=Math.max(a,Math.min(r,i,c,l)-u),o=Math.min(o,Math.max(r,i,c,l)+u),o<=a)return}e.intervals.push(a,o)}var _c=new WeakMap;function vc(){let e=globalThis;return e.HEPR_DEBUG_DISABLE_COMPOSITING===!0||typeof e.location?.search==`string`&&new URLSearchParams(e.location.search).has(`noComposite`)}function yc(e){if(!e.paintGraph||vc())return!1;let t=_c.get(e);if(t!==void 0)return t;let n=e.drawRuns??[],r=0,i=e=>{for(let t of e)if(t.kind===`group`){if(t.alpha!==1||t.knockout||t.softMask||t.blendMode!==`Normal`||!i(t.children))return!1}else{let e=n[r];if(!e||(t.kind===`draw`?t.runIndex!==r:e.kind!==`raster`||e.first!==t.rasterIndex||e.count!==1)||e.blendMode)return!1;r++}return!0},a=!i(e.paintGraph.roots)||r!==n.length;return _c.set(e,a),a}var bc=class{requiresCompositing;orderedRuns;snapshot=null;visibilityRevision=0;eligible=new Set;visibleRuns=[];selected=[];allVisible=!0;scene;defaults;constructor(e){this.scene=e,this.orderedRuns=e.drawRuns??[],this.requiresCompositing=yc(e),this.defaults=l(e),this.setVisibility(this.defaults)}get revision(){return this.visibilityRevision}setVisibility(e){if(e??=this.defaults,this.snapshot===e)return;this.snapshot=e,this.visibilityRevision++,this.eligible.clear();let t=t=>t===void 0||e.conditions[t]===1,n=[];for(let r of this.orderedRuns){let i=r.pdfRepresentation;i&&i.detail!==(e.rasterPages?.has(i.pageIndex)??!1)||g(this.scene,r,t)&&(this.eligible.add(r),n.push(r))}this.allVisible=n.length===this.orderedRuns.length,this.visibleRuns=this.allVisible?this.orderedRuns:n}isRunVisible(e){return this.eligible.has(e)}select(e){if(this.allVisible)return e;if(e===this.orderedRuns)return this.visibleRuns;this.selected.length=0;for(let t of e)this.eligible.has(t)&&this.selected.push(t);return this.selected}},xc=new WeakMap,Sc=new WeakMap,Cc=new WeakMap,wc=new WeakMap,Tc=new WeakMap;function Ec(e){let t=Tc.get(e);if(t!==void 0)return t;let n=!e.drawRuns?.some(e=>e.blendMode);if(n&&yc(e)){let t=e=>e.every(e=>e.kind!==`group`||e.alpha===1&&!e.knockout&&!e.softMask&&(e.blendMode===`Normal`||e.blendMode===`Darken`&&e.isolated)&&t(e.children));n=!!(e.paintGraph&&e.drawRuns&&Dc(e)&&t(F(e)))}return Tc.set(e,n),n}function Dc(e){let t=wc.get(e);if(t!==void 0)return t;let n=e.drawRuns??[],r=new Map;n.forEach((e,t)=>{e.kind===`raster`&&e.count===1&&r.set(e.first,t)});let i=0,a=e=>{for(let t of e)if(t.kind===`group`){if(t.softMask&&!a(t.softMask.children)||!a(t.children))return!1}else if((t.kind===`draw`?t.runIndex:r.get(t.rasterIndex))!==i++)return!1;return!0},o=a(F(e))&&i===n.length;return wc.set(e,o),o}function Oc(e){if(!e.drawRuns)return xc.get(e);let t=xc.get(e);if(!t){t=new Uint32Array(e.segmentCount);for(let e=0;e<t.length;e++)t[e]=e;xc.set(e,t)}return t}function kc(e,t){t&&xc.set(e,t)}function Ac(e){return xc.get(e)}function jc(e){return xc.has(e)||e.drawRuns!==void 0}function Mc(e,t){let n=xc.get(e);return n?n[t]:e.drawRuns?t:void 0}function Nc(e){Sc.delete(e),Cc.delete(e)}function Pc(e,t=!0){if(!e.drawRuns)return;let n=t?Sc:Cc,r=n.get(e);if(r)return r;r=new Uint32Array(e.segmentCount);let i=t&&e.paintGraph&&Dc(e)?te(e,!0,!1):null,a,o=-1,s;for(let t=0;t<e.drawRuns.length;t++){let n=e.drawRuns[t];if(n.kind!==`stroke`){a=void 0,s=void 0;continue}let l=n.first,u;i&&a&&o===t-1&&a.first+a.count===n.first&&i[o]===i[t]&&!n.blendMode&&!a.blendMode&&a.clipIndex===n.clipIndex&&a.optionalContent===n.optionalContent&&a.pdfRepresentation?.pageIndex===n.pdfRepresentation?.pageIndex&&a.pdfRepresentation?.detail===n.pdfRepresentation?.detail&&Fc(e,n.first-1,n.first)&&(s??=c(e,a,!1).sort((e,t)=>e-t),u=c(e,n,!1).sort((e,t)=>e-t),s.length===u.length&&s.every((e,t)=>e===u[t])&&(l=r[n.first-1]));for(let t=n.first;t<n.first+n.count;t++){let i=t*4,a=e.primitiveMeta[i+3],o=a-Math.floor(a/2+1e-6)*2;t>n.first&&(o<.999||a!==e.primitiveMeta[i-1]||e.styles[i+1]!==e.styles[i-3]||e.styles[i+2]!==e.styles[i-2]||e.styles[i+3]!==e.styles[i-1])&&(l=t),r[t]=l}a=n,o=t,s=u}return n.set(e,r),r}function Fc(e,t,n){let r=t*4,i=n*4,a=e.primitiveMeta[i+3];return a-Math.floor(a/2+1e-6)*2==1&&a===e.primitiveMeta[r+3]&&e.styles[i+1]===e.styles[r+1]&&e.styles[i+2]===e.styles[r+2]&&e.styles[i+3]===e.styles[r+3]}var Ic=[`endpoints`,`primitiveMeta`,`primitiveBounds`,`styles`],Lc=new WeakMap,Rc=new WeakMap,zc=new WeakMap;function Bc(e,t){let n=Lc.get(t);if(n)return n;let r=Math.max(0,e.segmentCount|0),i=[],a=r,o=(e,t)=>{t<=0||(i.push({base:a,scene:e}),a+=t)},s=t.find(e=>e.store)?.store;if(s){if(s.canonical!==e)throw Error(`Vector LOD store belongs to a different scene.`);o(s.literals,Math.max(0,s.literals.segmentCount|0))}let c=[],l=[];t.forEach((t,n)=>{if(t.store){if(t.store!==s)throw Error(`Vector LOD levels belong to different hierarchies.`);c.push(t.records??null),l.push(0);return}if(c.push(null),n===0&&t.scene===e){l.push(0);return}l.push(a),o(t.scene,Math.max(0,t.segmentCount|0))});let u={canonical:e,count:a,parts:i,records:c,bases:l};return Lc.set(t,u),u}function Vc(e){let t=[{first:0,count:Math.max(0,e.canonical.segmentCount|0),scene:e.canonical}];return e.parts.forEach((n,r)=>t.push({first:n.base,count:(e.parts[r+1]?.base??e.count)-n.base,scene:n.scene})),{count:e.count,segments:t}}function Hc(e){let t=e.canonical,n=Math.max(0,t.segmentCount|0);if(!jc(t))return;let r=new Uint32Array(e.count),i=Ac(t);if(i)r.set(i.subarray(0,n));else for(let e=0;e<n;e++)r[e]=e;for(let t of e.parts)r.set(Oc(t.scene),t.base);return r}function Uc(e,t){let n=Rc.get(t);if(n)return n;let r=Bc(e,t),i=Vc(r),a={layout:r,records:i,textures:ne(i)};return Rc.set(t,a),a}function Wc(e){if(!e.store)return e.scene;if(!e.records)return e.store.canonical;let t=zc.get(e.records);return t||(t=Kc(e),zc.set(e.records,t)),t}function Gc(e){return e.store?e.records?zc.get(e.records)??Kc(e):e.store.canonical:e.scene}function Kc(e){let{canonical:t,literals:n}=e.store,r=Math.max(0,t.segmentCount|0),i=Math.max(0,e.segmentCount|0),a=e.records,o={...t,segmentCount:i,bounds:e.sceneBounds,maxHalfWidth:e.maxHalfWidth};for(let e of Ic){let s=new Float32Array(i*4),c=qc(s),l=qc(t[e]),u=qc(n[e]);for(let e=0;e<i;e++){let t=a[e],n=t<r?l:u,i=(t<r?t:t-r)*4;c[e*4]=n[i],c[e*4+1]=n[i+1],c[e*4+2]=n[i+2],c[e*4+3]=n[i+3]}o[e]=s}if(jc(t)){let e=Oc(n),s=new Uint32Array(i);for(let n=0;n<i;n++){let i=a[n];s[n]=i<r?Mc(t,i):e[i-r]}kc(o,s)}return o}function qc(e){return new Uint32Array(e.buffer,e.byteOffset,e.length)}var Jc=15e4,Yc=[.5,1,2,4,8,16,32],Xc=5e4,Zc=15,Qc=class{ids=new dc(Zc,256);groups=[];get key(){return this.ids.tuple}get size(){return this.groups.length}values(){return this.groups}find(){let e=this.ids.find();return e>=0?this.groups[e]:void 0}add(e){this.ids.insert(),this.groups.push(e)}clear(){this.ids.clear(),this.groups.length=0}},$c={elapsedMs:0,buildCount:0,sourceSegmentCount:0,levelCount:0},el=new WeakMap,tl=14,nl=16384,rl=class{chunks=[];width;length=0;constructor(e){this.width=e}push(e){let t=this.chunkFor(this.length);t[this.length&16383]=e,this.length++}push4(e,t){let n=this.chunkFor(this.length),r=(this.length&16383)*4;n[r]=e[t],n[r+1]=e[t+1],n[r+2]=e[t+2],n[r+3]=e[t+3],this.length++}truncate(e){this.length=Math.min(this.length,e),this.chunks.length=Math.ceil(this.length/nl)}toTypedArray(){let e=new Uint32Array(this.length*this.width),t=nl*this.width;for(let n=0;n<this.chunks.length;n++){let r=n*t;e.set(this.chunks[n].subarray(0,Math.min(t,e.length-r)),r),this.chunks[n]=new Uint32Array}return this.chunks.length=0,this.length=0,e}chunkFor(e){let t=e>>>tl;return this.chunks[t]??(this.chunks[t]=new Uint32Array(nl*this.width))}},il=[`endpoints`,`primitiveMeta`,`primitiveBounds`,`styles`],al=class{canonicalCount;canonical;canonicalWords;canonicalOrigins;hasOrigins;fields=il.map(()=>new rl(4));literalOrigins;record=new Float32Array(16);recordWords=new Uint32Array(this.record.buffer);records=new rl(1);levelLiteralStart=0;literalCount=0;constructor(e){this.canonical=e,this.canonicalCount=Math.max(0,e.segmentCount|0),this.canonicalWords=il.map(t=>{let n=e[t];return new Uint32Array(n.buffer,n.byteOffset,n.length)}),this.canonicalOrigins=Ac(e),this.hasOrigins=jc(e),this.literalOrigins=this.hasOrigins?new rl(1):void 0}get levelRecordCount(){return this.records.length}beginLevel(){this.records=new rl(1),this.levelLiteralStart=this.literalCount}push(e,t,n,r,i,a){let o=this.record;o[0]=e.x0,o[1]=e.y0,o[2]=e.cx,o[3]=e.cy,o[4]=e.x1,o[5]=e.y1,o[6]=e.primitiveType,o[7]=e.alpha+e.flags*ul,o[8]=t,o[9]=n,o[10]=r,o[11]=i,o[12]=e.halfWidth,o[13]=e.colorR,o[14]=e.colorG,o[15]=e.colorB;let s=e.paintOrder??0,c=a>=0?a:this.hasOrigins&&e.paintOrder!==void 0?e.paintOrder:-1;if(c>=0&&c<this.canonicalCount&&(!this.hasOrigins||(this.canonicalOrigins?this.canonicalOrigins[c]:c)===s)&&this.matchesCanonical(c)){this.records.push(c);return}for(let e=0;e<il.length;e++)this.fields[e].push4(this.recordWords,e*4);this.literalOrigins?.push(s),this.records.push(this.canonicalCount+this.literalCount++)}endLevel(e){if(!e){this.literalCount=this.levelLiteralStart;for(let e of this.fields)e.truncate(this.literalCount);return this.literalOrigins?.truncate(this.literalCount),this.records=new rl(1),null}let t=this.records.toTypedArray();return this.records=new rl(1),t}finish(){let e=Object.assign(Object.defineProperties({},Object.getOwnPropertyDescriptors(this.canonical)),{segmentCount:this.literalCount});return il.forEach((t,n)=>{e[t]=new Float32Array(this.fields[n].toTypedArray().buffer)}),kc(e,this.literalOrigins?.toTypedArray()),e}matchesCanonical(e){let t=this.recordWords,n=e*4;for(let e=0;e<il.length;e++){let r=this.canonicalWords[e],i=e*4;if(r[n]!==t[i]||r[n+1]!==t[i+1]||r[n+2]!==t[i+2]||r[n+3]!==t[i+3])return!1}return!0}},ol=0,sl=1,cl=2,ll=4,ul=2,dl=Math.PI/720,fl=.985,pl=1.25,ml=5,hl=1e-12,gl=[0,1,4,5],_l=512,vl=256,yl=4096,bl=12,xl=96,Sl=.22,Cl=.45,wl=.1,Tl=3.2,El=8192,Dl=1,Ol=1.65,kl=.18,Al=1.15,jl=16,Ml=8,Nl=.25,Pl=1.1,Fl=1.5,Il=.05,Ll=8,Rl=25e4,zl=65535,Bl=192,Vl=class{levels;tileGrid;tileSelectedLevelIndices;projectedTileUnitsPerPixel;projectedTileWeights;projectedTileVisibleFractions;projectedTilePartial;projectedPlanes=new Float64Array(12);projectedClip=new Float64Array(32);projectedTileRect=new Float64Array(4);levelTileReach=[];projectedHalfWidth=1;projectedHalfHeight=1;projectedClipCut=!1;projectedRectDepth=0;projectedRectArea=0;maxHalfWidth;activeLevelIndex=0;forceExact=!1;useLocalToClip=!1;constantClipW=!1;finiteLocalToClip=!1;localToClip=new Float64Array(16);selectionProjectionBasis=new Float64Array(4);localUnitsPerPixel=1;lastVisibleSegmentCount=0;allLevelBounds={minX:1/0,minY:1/0,maxX:-1/0,maxY:-1/0};fullViewBaselineLevelIndex=-1;fullViewMaxLevelIndex=-1;selectionGuard=null;stats;constructor(e,t){let n=t?void 0:Yu.get(e);n&&(t=nd(e,n));let r=Wu();if(this.tileGrid=t?.tileGrid??du(e.bounds,Math.max(0,e.segmentCount|0),e),this.tileSelectedLevelIndices=new Int16Array(this.tileGrid.columns*this.tileGrid.rows),this.tileSelectedLevelIndices.fill(-1),this.projectedTileUnitsPerPixel=new Float64Array(this.tileGrid.columns*this.tileGrid.rows),this.projectedTileWeights=new Float64Array(this.tileGrid.columns*this.tileGrid.rows),this.projectedTileVisibleFractions=new Float64Array(this.tileGrid.columns*this.tileGrid.rows),this.projectedTilePartial=new Uint8Array(this.tileGrid.columns*this.tileGrid.rows),this.maxHalfWidth=Math.max(0,e.maxHalfWidth),this.levels=t?.levels??Wl(ql(e,this.tileGrid)),t?.allLevelBounds)Object.assign(this.allLevelBounds,t.allLevelBounds);else for(let e of this.levels){let t=e.records;for(let n=0;n<e.segmentCount;n++){let r=t?t[n]:n;this.allLevelBounds.minX=Math.min(this.allLevelBounds.minX,e.segmentMinX[r]),this.allLevelBounds.minY=Math.min(this.allLevelBounds.minY,e.segmentMinY[r]),this.allLevelBounds.maxX=Math.max(this.allLevelBounds.maxX,e.segmentMaxX[r]),this.allLevelBounds.maxY=Math.max(this.allLevelBounds.maxY,e.segmentMaxY[r])}}this.levels.length>0&&(this.activeLevelIndex=0),this.stats=this.createEmptyStats();let i=t?.elapsedMs??Wu()-r;t?.elapsedMs!==0&&(Gu(i,e.segmentCount,this.levels),su(i,e.segmentCount,this.levels.length)),Zu.set(e,new WeakRef(this))}setScreenSpaceTransform(){this.useLocalToClip&&(this.selectionGuard=null,this.fullViewBaselineLevelIndex=-1),this.useLocalToClip=!1}setForceExact(e){this.forceExact!==e&&(this.forceExact=e,this.selectionGuard=null,this.fullViewBaselineLevelIndex=-1,this.tileSelectedLevelIndices.fill(-1))}setLocalToClipTransform(e,t){let n=!0,r=this.useLocalToClip&&this.constantClipW;for(let t=0;t<16;t+=1){let r=Number(e[t]);n&&=Number.isFinite(r),this.localToClip[t]=r||0}this.finiteLocalToClip=n;let i=this.localToClip,a=Math.max(Math.abs(this.tileGrid.minX),Math.abs(this.tileGrid.maxX),Math.abs(this.allLevelBounds.minX),Math.abs(this.allLevelBounds.maxX)),o=Math.max(Math.abs(this.tileGrid.minY),Math.abs(this.tileGrid.maxY),Math.abs(this.allLevelBounds.minY),Math.abs(this.allLevelBounds.maxY)),s=i[15],c=Math.abs(i[3])*a+Math.abs(i[7])*o;this.constantClipW=n&&Math.abs(s)>1e-8&&Number.isFinite(c)&&c<=Math.abs(s)*hl;for(let e=0;e<2&&r;e++){let t=i[e]/s,n=i[e+4]/s,a=this.selectionProjectionBasis[e],o=this.selectionProjectionBasis[e+2],c=Math.max(Math.abs(t),Math.abs(n),Math.abs(a),Math.abs(o))*hl;(Math.abs(t-a)>c||Math.abs(n-o)>c)&&(r=!1)}if(!this.constantClipW||!r){this.selectionGuard=null,this.fullViewBaselineLevelIndex=-1;for(let e=0;e<gl.length;e++)this.selectionProjectionBasis[e]=i[gl[e]]/s}this.useLocalToClip=!0,this.localUnitsPerPixel=Hu(t)}updateForLocalUnitsPerPixel(e){return this.localUnitsPerPixel=Hu(e),this.activeLevelIndex=this.chooseLevelIndex(this.localUnitsPerPixel),this.activeLevelIndex>0}update(e,t,n){return this.levels.length<=0?(this.lastVisibleSegmentCount=0,this.stats=this.createEmptyStats(),!0):this.updateTiledVisibleSegments(e,t,n)}getStats(){return{...this.stats,activeLevels:this.stats.activeLevels.map(e=>({...e}))}}resetVisible(){this.fullViewBaselineLevelIndex=-1,this.selectionGuard=null,this.lastVisibleSegmentCount=0;for(let e of this.levels)e.visibleSegmentCount=0;this.stats=this.createEmptyStats()}estimateVisibleSegmentCount(){return this.lastVisibleSegmentCount>0?this.lastVisibleSegmentCount:this.levels[this.activeLevelIndex]?.segmentCount??0}getRenderedSegmentCount(){return this.lastVisibleSegmentCount}chooseLevelIndex(e,t=pl,n=!1){if(this.forceExact)return 0;let r=e*t;for(let e=this.levels.length-1;e>=1;--e)if((!n||this.levels[e].overview)&&this.levels[e].tolerance<=r)return e;return 0}updateTiledVisibleSegments(e,t,n){let r=gu(e,t,n,this.maxHalfWidth),i=this.chooseLevelIndex(this.localUnitsPerPixel),a=Math.max(i,this.chooseLevelIndex(this.localUnitsPerPixel,ml,!0)),o=bu(r.minX,r.minY,r.maxX,r.maxY,this.tileGrid),s=!this.useLocalToClip||this.constantClipW&&n!=null&&[n.minX,n.minY,n.maxX,n.maxY].every(Number.isFinite)&&n.minX<=n.maxX&&n.minY<=n.maxY,c=s&&o!==null&&o.c0===0&&o.r0===0&&o.c1===this.tileGrid.columns-1&&o.r1===this.tileGrid.rows-1&&r.minX<=this.allLevelBounds.minX&&r.minY<=this.allLevelBounds.minY&&r.maxX>=this.allLevelBounds.maxX&&r.maxY>=this.allLevelBounds.maxY;if(c&&this.fullViewBaselineLevelIndex===i&&this.fullViewMaxLevelIndex===a)return!1;let l=s&&this.levels[0].segmentCount>=15e4&&[r.minX,r.minY,r.maxX,r.maxY].every(Number.isFinite)?256*this.localUnitsPerPixel:0,u=this.selectionGuard;if(l>0&&u&&o&&u.baseline===i&&u.maxLevel===a&&o.c0>=u.range.c0&&o.c1<=u.range.c1&&o.r0>=u.range.r0&&o.r1<=u.range.r1&&r.minX>=u.bounds.minX&&r.minY>=u.bounds.minY&&r.maxX<=u.bounds.maxX&&r.maxY<=u.bounds.maxY&&u.bounds.maxX-u.bounds.minX<=r.maxX-r.minX+l*4&&u.bounds.maxY-u.bounds.minY<=r.maxY-r.minY+l*4)return!1;if(this.selectionGuard=null,this.fullViewBaselineLevelIndex=-1,this.resetLevelDrawLists(),!o)return this.lastVisibleSegmentCount=0,this.updateLevelStats(0,0,0,0,i,0,i,i),!0;let d=l>0?{minX:r.minX-l,minY:r.minY-l,maxX:r.maxX+l,maxY:r.maxY+l}:null,f=d&&[d.minX,d.minY,d.maxX,d.maxY].every(Number.isFinite)?d:r,p=this.useLocalToClip&&!this.constantClipW?this.projectTiles(o,t):-1,m=p>=0,h=!m&&f!==r?bu(f.minX,f.minY,f.maxX,f.maxY,this.tileGrid)??o:o,g=0,_=0;for(let e=o.r0;e<=o.r1;e++)for(let t=o.c0;t<=o.c1;t++){let n=e*this.tileGrid.columns+t;m&&this.projectedTileUnitsPerPixel[n]<0||(g++,this.levels[0].tileCounts[n]>0&&_++)}let v=Math.max(Dl,Math.ceil(Xc/Math.max(1,_))),y=m?this.levels.length:i,b=0,x=0,S=0,C=i,w=0,T=i,E=!this.forceExact&&this.levels.some(e=>e.overview),D=Xc*Ol;for(let e=0;e<2;e++){e>0&&(this.resetLevelDrawLists(),y=m?this.levels.length:i,b=0,x=0,w=0);let t=0;selectTiles:for(let n=h.r0;n<=h.r1;n+=1)for(let r=h.c0;r<=h.c1;r+=1){let s=n*this.tileGrid.columns+r,c=n>=o.r0&&n<=o.r1&&r>=o.c0&&r<=o.c1,l=this.levels[0].tileCounts[s],u=i,d=a,h=v,g=null;if(m){let e=this.projectedTileUnitsPerPixel[s];if(e<0||l===0)continue;for(u=this.chooseLevelIndex(e),d=Math.max(u,this.chooseLevelIndex(e,ml,!0));d>0&&!this.tileReachWithinBudget(s,d);)d--;u=Math.min(u,d),p>0&&(h=Math.max(Dl,Math.round(Xc*this.projectedTileWeights[s]/p))),b+=h,this.projectedTilePartial[s]&&(g=this.projectedPlanes),y=Math.min(y,u)}let _=this.chooseTileLevel(s,h,u,d,e>0),O=this.levels[_].tileCounts[s];if(!c){_u(this.levels[_],s,f,g);continue}l>x&&(x=l,S=O,C=_),O>w&&(w=O,T=_);let k=this.levels[_],A=k.visibleSegmentCount;if(_u(k,s,f,g,E&&e===0?82501-t:1/0),t+=k.visibleSegmentCount-A,E&&e===0&&t>D)break selectTiles}if(!E||t<=D)break}return m&&(y>=this.levels.length&&(y=i),_>0&&(v=Math.round(b/_))),this.activeLevelIndex=y,this.updateLevelStats(g,v,x,S,C,w,T,y),c&&(this.fullViewBaselineLevelIndex=i,this.fullViewMaxLevelIndex=a),f!==r&&(this.selectionGuard={bounds:f,range:h,baseline:i,maxLevel:a}),!0}resetLevelDrawLists(){for(let e of this.levels)e.visibleSegmentCount=0,e.markToken+=1,e.markToken>=2**(8*e.segmentMarks.BYTES_PER_ELEMENT)-1&&(e.segmentMarks.fill(0),e.markToken=1)}chooseTileLevel(e,t,n,r,i=!1){if(this.forceExact||this.levels[0].tileCounts[e]<=t)return this.tileSelectedLevelIndices[e]=0,0;for(let r=1;r<=n;r++)if(!this.levels[r].overview&&this.levels[r].tileCounts[e]<=t)return this.tileSelectedLevelIndices[e]=r,r;let a=this.chooseTargetBalancedTileLevel(e,t,r),o=Math.max(1,t*Ol);if(i&&this.levels[a].tileCounts[e]>o)for(let t=r+1;t<this.levels.length;t++){if(!this.levels[t].overview)continue;let n=this.levels[t].tileCounts[e];if(n<this.levels[a].tileCounts[e]&&(a=t),n<=o)break}let s=this.tileSelectedLevelIndices[e];if(s>=0&&s<=r){let n=this.levels[s].tileCounts[e];if(n<=o){let r=this.levels[a].tileCounts[e];if(wu(n,t)<=wu(r,t)+Math.max(2,t*kl))return s}}return this.tileSelectedLevelIndices[e]=a,a}chooseTargetBalancedTileLevel(e,t,n){let r=Math.max(1,t*Ol),i=-1,a=1/0,o=1/0,s=n;for(let c=0;c<=n;c+=1){let n=this.levels[c].tileCounts[e];if((n<o||n===o&&c<s)&&(o=n,s=c),n>r)continue;let l=wu(n,t);(l<a||l===a&&(i<0||c<i))&&(a=l,i=c)}return i>=0?i:s}projectTiles(e,t){if(!this.finiteLocalToClip)return-1;let n=this.localToClip;this.projectedHalfWidth=Math.max(1,t.width)*.5,this.projectedHalfHeight=Math.max(1,t.height)*.5;let r=this.projectedPlanes;for(let e=0;e<2;e++){let t=1+jl/(e===0?this.projectedHalfWidth:this.projectedHalfHeight);for(let i=0;i<2;i++){let a=i===0?1:-1,o=(e*2+i)*3;r[o]=n[3]*t+a*n[e],r[o+1]=n[7]*t+a*n[4+e],r[o+2]=n[15]*t+a*n[12+e]}}let i=this.tileGrid,a=this.projectedTileRect,o=1/0;for(let t=e.r0;t<=e.r1;t++)for(let n=e.c0;n<=e.c1;n++){let e=t*i.columns+n;this.readProjectedTileRect(e);let r=this.projectRect(a[0],a[1],a[2],a[3]);this.projectedTileUnitsPerPixel[e]=r,!(r<0)&&(o=Math.min(o,this.projectedRectDepth),this.projectedTileWeights[e]=this.projectedRectDepth,this.projectedTilePartial[e]=+!!this.projectedClipCut,this.projectedTileVisibleFractions[e]=Math.min(1,this.projectedRectArea/Math.max(1e-300,(a[2]-a[0])*(a[3]-a[1]))))}let s=0;for(let t=e.r0;t<=e.r1;t++)for(let n=e.c0;n<=e.c1;n++){let e=t*i.columns+n;if(this.projectedTileUnitsPerPixel[e]<0)continue;let r=this.projectedTileWeights[e],a=o>0?o/r:r>0?0:1,c=a*a*a;this.projectedTileWeights[e]=c,this.levels[0].tileCounts[e]>0&&(s+=c*this.projectedTileVisibleFractions[e])}return s}readProjectedTileRect(e){let t=this.tileGrid,n=e%t.columns,r=(e-n)/t.columns,i=this.projectedTileRect,a=(t.xEdges[n+1]-t.xEdges[n])*Nl,o=(t.yEdges[r+1]-t.yEdges[r])*Nl;i[0]=(n===0?Math.min(t.xEdges[0],this.allLevelBounds.minX):t.xEdges[n])-a,i[1]=(r===0?Math.min(t.yEdges[0],this.allLevelBounds.minY):t.yEdges[r])-o,i[2]=(n===t.columns-1?Math.max(t.xEdges[n+1],this.allLevelBounds.maxX):t.xEdges[n+1])+a,i[3]=(r===t.rows-1?Math.max(t.yEdges[r+1],this.allLevelBounds.maxY):t.yEdges[r+1])+o}projectRect(e,t,n,r){let i=this.clipRectToFrustum(e,t,n,r);if(i<3)return-1;let a=this.localToClip,o=this.projectedClip,s=this.projectedHalfWidth,c=this.projectedHalfHeight,l=1/0,u=0,d=0,f=0;for(let e=0;e<i;e++){let t=o[e*2],n=o[e*2+1],r=a[0]*t+a[4]*n+a[12],p=a[1]*t+a[5]*n+a[13],m=a[3]*t+a[7]*n+a[15],h=(a[0]*m-r*a[3])*s,g=(a[4]*m-r*a[7])*s,_=(a[1]*m-p*a[3])*c,v=(a[5]*m-p*a[7])*c,y=h*h+g*g+_*_+v*v,b=h*v-g*_;u=Math.max(u,Math.sqrt(.5*(y+Math.sqrt(Math.max(0,y*y-4*b*b))))),l=Math.min(l,m),d+=m;let x=e+1<i?e+1:0;f+=t*o[x*2+1]-o[x*2]*n}return this.projectedRectDepth=Math.max(0,d/i),this.projectedRectArea=Math.abs(f)*.5,l>0?u>0?l*l/u:1/0:0}tileReachWithinBudget(e,t){let n=this.getLevelTileReach(t),r=e*4,i=n[r],a=n[r+1],o=n[r+2],s=n[r+3];if(!(i<=o&&a<=s))return!0;this.readProjectedTileRect(e);let c=this.projectedTileRect;if(i>=c[0]&&a>=c[1]&&o<=c[2]&&s<=c[3])return!0;let l=this.projectRect(i,a,o,s);return l<0||this.levels[t].tolerance<=l*ml}getLevelTileReach(e){let t=this.levelTileReach[e];if(t)return t;let n=this.levels[e],r=this.tileGrid.columns*this.tileGrid.rows;t=new Float32Array(r*4);let i=n.records;for(let e=0;e<r;e++){let r=1/0,a=1/0,o=-1/0,s=-1/0,c=n.tileOffsets[e],l=c+n.tileCounts[e];for(let e=c;e<l;e++){let t=i?i[n.tileSegmentIds[e]]:n.tileSegmentIds[e];r=Math.min(r,n.segmentMinX[t]),a=Math.min(a,n.segmentMinY[t]),o=Math.max(o,n.segmentMaxX[t]),s=Math.max(s,n.segmentMaxY[t])}t[e*4]=r,t[e*4+1]=a,t[e*4+2]=o,t[e*4+3]=s}return this.levelTileReach[e]=t,t}clipRectToFrustum(e,t,n,r){let i=this.projectedClip,a=this.projectedPlanes;i[0]=e,i[1]=t,i[2]=n,i[3]=t,i[4]=n,i[5]=r,i[6]=e,i[7]=r;let o=4,s=0,c=!1;for(let e=0;e<a.length&&o>0;e+=3){let t=a[e],n=a[e+1],r=a[e+2],l=16-s,u=0,d=i[s+o*2-2],f=i[s+o*2-1],p=t*d+n*f+r;for(let e=0;e<o;e++){let a=i[s+e*2],o=i[s+e*2+1],m=t*a+n*o+r;if(m>=0!=p>=0&&u<Ml){let e=p/(p-m);i[l+u*2]=d+(a-d)*e,i[l+u*2+1]=f+(o-f)*e,u++}m<0?c=!0:u<Ml&&(i[l+u*2]=a,i[l+u*2+1]=o,u++),d=a,f=o,p=m}o=u,s=l}return this.projectedClipCut=c,o}updateLevelStats(e,t,n,r,i,a,o,s){let c=0,l=[];for(let e=0;e<this.levels.length;e+=1){let t=this.levels[e],n=t.visibleSegmentCount;c+=n,n>0&&l.push({index:e,overview:t.overview,tolerance:t.tolerance,renderedSegments:n})}this.lastVisibleSegmentCount=c,this.stats={renderedSegments:c,visibleTileCount:e,targetSegmentsPerTile:t,baselineLevelIndex:s,baselineTolerance:this.levels[s]?.tolerance??0,activeLevels:l,maxBaselineTileSegments:n,maxBaselineTileSelectedSegments:r,maxBaselineTileSelectedLevelIndex:i,maxBaselineTileSelectedTolerance:this.levels[i]?.tolerance??0,maxSelectedTileSegments:a,maxSelectedTileLevelIndex:o,maxSelectedTileTolerance:this.levels[o]?.tolerance??0,tileGridColumns:this.tileGrid.columns,tileGridRows:this.tileGrid.rows,totalLevels:this.levels.length}}createEmptyStats(){return{renderedSegments:0,visibleTileCount:0,targetSegmentsPerTile:0,baselineLevelIndex:this.activeLevelIndex,baselineTolerance:this.levels[this.activeLevelIndex]?.tolerance??0,activeLevels:[],maxBaselineTileSegments:0,maxBaselineTileSelectedSegments:0,maxBaselineTileSelectedLevelIndex:this.activeLevelIndex,maxBaselineTileSelectedTolerance:this.levels[this.activeLevelIndex]?.tolerance??0,maxSelectedTileSegments:0,maxSelectedTileLevelIndex:this.activeLevelIndex,maxSelectedTileTolerance:this.levels[this.activeLevelIndex]?.tolerance??0,tileGridColumns:this.tileGrid.columns,tileGridRows:this.tileGrid.rows,totalLevels:this.levels.length}}};function Hl(e,t,n){return e===`off`||t!==`webgl`&&t!==`webgpu`?!1:e===`force`?n>0:n>=Jc}function Ul(e,t){let n=e.segmentCount>5e4&&(t??Ec(e));return[...n?[{tolerance:Yc[0],overview:!1}]:[],...Yc.map(e=>({tolerance:e,overview:n}))]}function Wl(e){for(;;){let t=e.next();if(t.done)return t.value}}async function Gl(e,t){try{for(;;){let n=e.next();if(n.done)return n.value;n.value.yieldable?await t.maybeYield(!1,n.value.value,n.value.message):t.report(n.value.value,n.value.message)}}finally{e.return(void 0)}}function*Kl(e,t=Ec(e)){let n=Math.max(0,e.segmentCount|0),r=new al(e),i=[{tolerance:0,segmentCount:n,sceneBounds:e.bounds,maxHalfWidth:e.maxHalfWidth}],a=n,o=Ul(e,t),s=o.length;try{for(let n=0;n<s;n+=1){let{tolerance:c,overview:l}=o[n],u=.06+n/s*.62,d=.06+(n+1)/s*.62;yield{value:u,message:`Simplifying Vector LOD ${n+1}/${s}`,yieldable:!1};let f=yield*iu(e,c,l,r,u,d,t),p=f!==null&&f.segmentCount>0&&f.segmentCount<a*fl,m=r.endLevel(p);f&&m&&(i.push({tolerance:c,overview:l,segmentCount:f.segmentCount,records:m,sceneBounds:f.bounds,maxHalfWidth:f.maxHalfWidth}),a=f.segmentCount)}}finally{Nc(e)}return{store:{canonical:e,literals:r.finish()},levels:i}}function*ql(e,t,n){let r=yield*Kl(e,n),i=yield*Yl(r.store,.68,.72),a=[],o=Math.max(1,r.levels.length);for(let e=0;e<r.levels.length;e+=1){let n=r.levels[e],s=.72+e/o*.26,c=.72+(e+1)/o*.26;yield{value:s,message:`Building Vector LOD buckets ${e+1}/${r.levels.length}`,yieldable:!1};let l=yield*Xl(n.records,n.segmentCount,i,t,s,c);a.push(new Jl(r.store,n,l,i))}return a}var Jl=class{overview;tolerance;segmentCount;records;store;sceneBounds;maxHalfWidth;tileOffsets;tileCounts;tileSegmentIds;segmentMarks;segmentMinX;segmentMinY;segmentMaxX;segmentMaxY;visibleSegmentIds;visibleSegmentCount=0;markToken=1;constructor(e,t,n,r){this.overview=t.overview,this.tolerance=t.tolerance,this.segmentCount=t.segmentCount,this.records=t.records,this.store=e,this.sceneBounds=t.sceneBounds,this.maxHalfWidth=t.maxHalfWidth,this.tileOffsets=n.tileOffsets,this.tileCounts=n.tileCounts,this.tileSegmentIds=n.tileSegmentIds,this.segmentMarks=new Uint8Array(t.segmentCount),this.segmentMinX=r.minX,this.segmentMinY=r.minY,this.segmentMaxX=r.maxX,this.segmentMaxY=r.maxY,this.visibleSegmentIds=new Uint32Array(Math.max(1,Math.min(4096,t.segmentCount)))}get scene(){return Wc(this)}};function*Yl(e,t,n){let r=Math.max(0,e.canonical.segmentCount|0),i=r+Math.max(0,e.literals.segmentCount|0),a=new Float32Array(i),o=new Float32Array(i),s=new Float32Array(i),c=new Float32Array(i),l={minX:0,minY:0,maxX:0,maxY:0};for(let u=0;u<i;u+=1){u<r?yu(e.canonical,u,l):yu(e.literals,u-r,l);let d=.35;a[u]=l.minX-d,o[u]=l.minY-d,s[u]=l.maxX+d,c[u]=l.maxY+d,u&8191||(yield{value:t+(n-t)*(u/Math.max(1,i)),message:`Preparing Vector LOD bounds`,yieldable:!0})}return{minX:a,minY:o,maxX:s,maxY:c}}function*Xl(e,t,n,r,i,a,o=1/0){let s=0,c=r.columns*r.rows,l=new Uint32Array(c),u={c0:0,c1:0,r0:0,r1:0};for(let c=0;c<t;c+=1){let d=e?e[c]:c;if(xu(n.minX[d],n.minY[d],n.maxX[d],n.maxY[d],r,u)){if(s+=(u.r1-u.r0+1)*(u.c1-u.c0+1),s>o)throw Error(`Vector LOD tile index resource limit exceeded`);for(let e=u.r0;e<=u.r1;e+=1){let t=e*r.columns+u.c0;for(let e=u.c0;e<=u.c1;e+=1)l[t]+=1,t+=1}}c&4095||(yield{value:i+(a-i)*.5*c/Math.max(1,t),message:`Counting Vector LOD tiles`,yieldable:!0})}let d=new Uint32Array(c+1);for(let e=0;e<c;e+=1)d[e+1]=d[e]+l[e];let f=new Uint32Array(d[c]),p=d.slice(0,c);for(let o=0;o<t;o+=1){let s=e?e[o]:o;if(xu(n.minX[s],n.minY[s],n.maxX[s],n.maxY[s],r,u))for(let e=u.r0;e<=u.r1;e+=1){let t=e*r.columns+u.c0;for(let e=u.c0;e<=u.c1;e+=1){let e=p[t];f[e]=o,p[t]=e+1,t+=1}}o&4095||(yield{value:i+(a-i)*(.5+.5*o/Math.max(1,t)),message:`Assigning Vector LOD tiles`,yieldable:!0})}return{tileOffsets:d,tileCounts:l,tileSegmentIds:f}}async function Zl(e,t,n,r={}){return eu(e,t,n,r,!0)}async function Ql(e,t={}){let n=new lu(t),r=Wu();await n.maybeYield(!0,0,`Preparing Vector LOD`);let i=du(e.bounds,Math.max(0,e.segmentCount|0),e);await n.maybeYield(!0,.04,`Partitioning stroke density`);let a=await Gl(Kl(e),n);await n.maybeYield(!0,.99,`Finalizing Vector LOD`);let o=a.store.literals,s=new Uint32Array,c={tileGrid:i,literals:{segmentCount:o.segmentCount,endpoints:o.endpoints,primitiveMeta:o.primitiveMeta,primitiveBounds:o.primitiveBounds,styles:o.styles},origins:Ac(o),levels:a.levels.map(e=>({tolerance:e.tolerance,overview:e.overview,segmentCount:e.segmentCount,records:e.records,sceneBounds:e.sceneBounds,maxHalfWidth:e.maxHalfWidth,tileOffsets:s,tileCounts:s,tileSegmentIds:s}))};n.report(1,`Vector LOD ready`);let l=Wu()-r;return Gu(l,e.segmentCount,a.levels),su(l,e.segmentCount,a.levels.length),c}async function $l(e,t,n,r={}){let i=await eu(e,t,n,r,!1);return i?{take(t){if(t!==e)throw Error(`Vector LOD reservation belongs to a different scene.`);if(!i)throw Error(`Vector LOD reservation has already been consumed or released.`);let n=i;return i=null,n},release(){if(!i)return;let t=i;i=null,nu(e,t)}}:null}async function eu(t,n,r,i,a){if(!Hl(n,r,t.segmentCount))return null;let o=new lu(i),s=Wu();o.report(0,`Preparing Vector LOD`);let c=tu(t);if(c){let e=!1;try{return await o.maybeYield(!0,.99,`Reusing Vector LOD`),o.report(1,`Vector LOD ready`),e=!0,c}finally{(a||!e)&&ru(t,c)}}if(Yu.get(t)){if(i.signal?.aborted||i.shouldCancel?.())throw new cu;let e=new Vl(t);a&&ru(t,e);try{if(o.report(1,`Stored Vector LOD ready`),i.signal?.aborted||i.shouldCancel?.())throw new cu}catch(n){throw a||ru(t,e),n}return e}let l=null;if(typeof Worker<`u`&&t.segmentCount>=15e4){let n;try{n=await e(()=>import(`./lodWorkerClient-BvKlBoBI.js`),[],import.meta.url)}catch(e){console.warn(`[HEPR] LOD worker module unavailable; preparing cooperatively.`,e)}n&&(l=await n.buildVectorLodInWorker(t,void 0,{...i,onProgress:e=>o.report(e.value,e.message)}))}let u;if(l){let e=l.data;Xu.set(e,l),u=nd(t,e),u.elapsedMs=Wu()-s}else{let e=du(t.bounds,Math.max(0,t.segmentCount|0),t);await o.maybeYield(!0,.04,`Partitioning stroke density`),u={tileGrid:e,levels:await Gl(ql(t,e),o),elapsedMs:Wu()-s}}o.report(.99,`Finalizing Vector LOD`),await o.maybeYield(!0,.99,`Finalizing Vector LOD`),u.elapsedMs=Wu()-s;let d=new Vl(t,u);a&&ru(t,d);try{o.report(1,`Vector LOD ready`)}catch(e){throw a||ru(t,d),e}return d}function tu(e){let t=el.get(e)??null;return el.delete(e),t}function nu(e,t){t.setForceExact(!1),t.resetVisible(),ru(e,t)}function ru(e,t){el.set(e,t)}function*iu(e,t,n,r,i,a,o){r.beginLevel();let s=Math.max(0,e.segmentCount|0);if(s<=0||t<=0)return null;let c=Uu(t),l=`Simplifying ${c}`,u=`Aggregating ${c}`,d=`Merging ${c}`,f=(e,t)=>({value:i+(a-i)*e,message:t,yieldable:!0}),p=Ru(e.bounds,t),m=n?void 0:Pc(e,!1),h=new pc(t,n,t=>{let n=Eu(e,t);return n&&m&&(n.paintGroup=m[t]),n}),g=!n&&o?new Qc:null,_=Bu(),v=0,y=NaN,b=NaN,x=NaN,S=Tu(e),C,w=0;for(let i=0;i<s;i+=1){i&4095||(yield f(i/Math.max(1,s)*.72,l));let a=Eu(e,i);if(!a||a.alpha<=.001)continue;let o=S&&a.paintGroup!==C;if(o||(g||n)&&!e.drawRuns&&(a.colorR!==y||a.colorG!==b||a.colorB!==x)){let c=0;for(let n of g?.values()??[])Au(e,n,r,_,t*Il),++c&1023||(yield f(.72*i/Math.max(1,s),u));if(n||o){for(let e of h.values())Nu(e,r,_,t),++c&1023||(yield f(.72*i/Math.max(1,s),d));h.clear()}o&&(w+=g?.size??0),g?.clear(),C=a.paintGroup,y=a.colorR,b=a.colorG,x=a.colorB}if(n&&ju(a,t))continue;if(g&&Du(g,a,i,t,w)){v=Math.max(v,a.halfWidth);continue}if(a.primitiveType>=.5||!n&&Mu(a,t)){Fu(r,_,a,i),v=Math.max(v,a.halfWidth);continue}let c=a.x1-a.x0,T=a.y1-a.y0;if(c===0&&T===0){(a.flags&cl)!==0&&(Fu(r,_,a,i),v=Math.max(v,a.halfWidth));continue}let E=zu(Iu(a),Lu(a),e.bounds,p);h.add(m?{...a,paintGroup:m[i]}:a,i,E),v=Math.max(v,a.halfWidth)}let T=0;for(let n of g?.values()??[])Au(e,n,r,_,t*Il),++T&1023||(yield f(.72,u));let E=0,D=Math.max(1,h.size);for(let e of h.values())Nu(e,r,_,t),E+=1,E&1023||(yield f(.72+.28*E/D,d));h.clear(),g?.clear();let O=r.levelRecordCount;return O===0?null:{segmentCount:O,bounds:Vu(_,e.bounds),maxHalfWidth:v}}function au(){$c={elapsedMs:0,buildCount:0,sourceSegmentCount:0,levelCount:0}}function ou(){let e={...$c};return au(),e}function su(e,t,n){$c.elapsedMs+=Math.max(0,e),$c.buildCount+=1,$c.sourceSegmentCount+=Math.max(0,t|0),$c.levelCount+=Math.max(0,n|0)}var cu=class extends Error{constructor(){super(`Vector LOD build cancelled.`),this.name=`VectorStrokeLodBuildCancelledError`}},lu=class{yieldIntervalMs;onProgress;shouldCancel;signal;lastYieldAt=Wu();lastProgressValue=-1;constructor(e){this.yieldIntervalMs=Math.max(50,Math.trunc(e.yieldIntervalMs??50)),this.onProgress=e.onProgress,this.shouldCancel=e.shouldCancel,this.signal=e.signal}report(e,t){let n=Ku(e);n<this.lastProgressValue&&this.lastProgressValue>=0||(this.lastProgressValue=n,this.onProgress?.({value:n,message:t}))}async maybeYield(e,t,n){if(this.signal?.aborted||this.shouldCancel?.())throw new cu;this.report(t,n);let r=Wu();if(!(!e&&r-this.lastYieldAt<this.yieldIntervalMs)&&(await uu(),this.lastYieldAt=Wu(),this.signal?.aborted||this.shouldCancel?.()))throw new cu}};function uu(){return new Promise(e=>{globalThis.setTimeout(e,0)})}function du(e,t,n){let r=Math.max(1e-6,e.maxX-e.minX),i=Math.max(1e-6,e.maxY-e.minY),a=Ju(Math.round(Math.max(1,t)/_l),vl,yl),o=r/i,s=Math.round(Math.sqrt(a*o)),c=Math.round(a/Math.max(1,s));s=Ju(s,bl,xl),c=Ju(c,bl,xl);let l=fu(e.minX,e.maxX,s,n,`x`),u=fu(e.minY,e.maxY,c,n,`y`);return{columns:s,rows:c,minX:e.minX,minY:e.minY,maxX:e.maxX,maxY:e.maxY,tileWidth:r/s,tileHeight:i/c,xEdges:l,yEdges:u}}function fu(e,t,n,r,i){if(!r||n<=1||r.segmentCount<=n*4)return hu(e,t,n);let a=Math.max(1e-9,t-e),o=Math.max(0,r.segmentCount|0),s=Ju(n*16,256,4096),c=new Float64Array(s),l=new Map,u={minX:0,minY:0,maxX:0,maxY:0},d=0;for(let t=0;t<o;t+=1){yu(r,t,u);let n=i===`x`?u.minX:u.minY,o=i===`x`?u.maxX:u.maxY,f=(n+o)*.5;if(!Number.isFinite(f))continue;let p=(f-e)/a,m=Ju(Math.floor(p*s),0,s-1),h=Ju(Math.floor((Math.min(n,o)-e)/a*s),0,s-1),g=Ju(Math.floor((Math.max(n,o)-e)/a*s),0,s-1),_=mu(r,t);c[m]+=Cl,pu(l,_,m,1),h!==m&&(c[h]+=wl,pu(l,_,h,wl)),g!==m&&g!==h&&(c[g]+=wl,pu(l,_,g,wl)),d+=1}if(d<=n)return hu(e,t,n);for(let[e,t]of l){let n=e%El;c[n]+=Math.sqrt(Math.max(0,t))*Tl}let f=Math.max(1e-6,d/s*.015),p=0;for(let e=0;e<s;e+=1)c[e]+=f,p+=c[e];let m=new Float64Array(n+1);m[0]=e,m[n]=t;let h=a/n*Sl,g=0,_=0;for(let r=1;r<n;r+=1){let i=p*r/n;for(;g<s-1&&_+c[g]<i;)_+=c[g],g+=1;let o=Math.max(1e-9,c[g]),l=qu((i-_)/o,0,1),u=e+(g+l)/s*a,d=m[r-1]+h,f=t-(n-r)*h;m[r]=qu(u,d,f)}return m}function pu(e,t,n,r){let i=t*El+n;e.set(i,(e.get(i)??0)+r)}function mu(e,t){let n=t*4,r=Math.max(0,e.styles[n]??0),i=e.primitiveMeta[n+3]??0,a=Math.max(0,Math.floor(i/ul+1e-6)),o=Ku(i-a*ul),s=Ju(Math.round(Math.log1p(r)*32),0,255),c=a&3,l=Ju(Math.round(o*15),0,15),u=Ju(Math.round(Ku(e.styles[n+1]??0)*31),0,31),d=Ju(Math.round(Ku(e.styles[n+2]??0)*31),0,31),f=Ju(Math.round(Ku(e.styles[n+3]??0)*31),0,31);return((((s*4+c)*16+l)*32+u)*32+d)*32+f}function hu(e,t,n){let r=new Float64Array(n+1),i=t-e;for(let t=0;t<=n;t+=1)r[t]=e+i*t/n;return r[0]=e,r[n]=t,r}function gu(e,t,n,r){let i=Math.max(1e-6,e.zoom),a=Math.max(1,t.width)/(2*i),o=Math.max(1,t.height)/(2*i),s=Math.max(16/i,r*2,.5);return n?{minX:n.minX-s,minY:n.minY-s,maxX:n.maxX+s,maxY:n.maxY+s}:{minX:e.cameraCenterX-a-s,minY:e.cameraCenterY-o-s,maxX:e.cameraCenterX+a+s,maxY:e.cameraCenterY+o+s}}function _u(e,t,n,r=null,i=1/0){let a=e.tileOffsets[t],o=a+e.tileCounts[t],s=e.records,c=e.visibleSegmentCount,l=c+i;for(let t=a;t<o&&c<l;t+=1){let i=e.tileSegmentIds[t];if(e.segmentMarks[i]===e.markToken)continue;let a=s?s[i]:i,o=e.segmentMinX[a],l=e.segmentMinY[a],u=e.segmentMaxX[a],d=e.segmentMaxY[a];if(!(u<n.minX||o>n.maxX||d<n.minY||l>n.maxY)&&(!r||vu(r,o,l,u,d))){if(e.segmentMarks[i]=e.markToken,c===e.visibleSegmentIds.length){let t=new Uint32Array(Math.min(e.segmentMarks.length,Math.max(1,c*2)));t.set(e.visibleSegmentIds),e.visibleSegmentIds=t}e.visibleSegmentIds[c]=i,c+=1}}e.visibleSegmentCount=c}function vu(e,t,n,r,i){for(let a=0;a<e.length;a+=3){let o=e[a],s=e[a+1];if(o*(o>=0?r:t)+s*(s>=0?i:n)+e[a+2]<0)return!1}return!0}function yu(e,t,n){let r=t*4,i=Math.max(0,e.styles[r]??0);if((Math.floor(e.primitiveMeta[r+3]/ul+1e-6)&ll)===0){n.minX=e.primitiveBounds[r]-i,n.minY=e.primitiveBounds[r+1]-i,n.maxX=e.primitiveBounds[r+2]+i,n.maxY=e.primitiveBounds[r+3]+i;return}n.minX=Math.max(e.primitiveBounds[r],Math.min(e.endpoints[r],e.endpoints[r+2],e.primitiveMeta[r])-i),n.minY=Math.max(e.primitiveBounds[r+1],Math.min(e.endpoints[r+1],e.endpoints[r+3],e.primitiveMeta[r+1])-i),n.maxX=Math.min(e.primitiveBounds[r+2],Math.max(e.endpoints[r],e.endpoints[r+2],e.primitiveMeta[r])+i),n.maxY=Math.min(e.primitiveBounds[r+3],Math.max(e.endpoints[r+1],e.endpoints[r+3],e.primitiveMeta[r+1])+i),(n.minX>n.maxX||n.minY>n.maxY)&&(n.minX=n.minY=1/0,n.maxX=n.maxY=-1/0)}function bu(e,t,n,r,i){let a={c0:0,c1:0,r0:0,r1:0};return xu(e,t,n,r,i,a)?a:null}function xu(e,t,n,r,i,a){return n<i.minX||e>i.maxX||r<i.minY||t>i.maxY?!1:(a.c0=Su(i.xEdges,e),a.c1=Cu(i.xEdges,n),a.r0=Su(i.yEdges,t),a.r1=Cu(i.yEdges,r),!0)}function Su(e,t){let n=e.length-2;if(t<=e[0])return 0;if(t>=e[e.length-1])return n;let r=0,i=e.length-1;for(;r+1<i;){let n=r+i>>1;e[n]<=t?r=n:i=n}return Ju(r,0,n)}function Cu(e,t){return Su(e,t)}function wu(e,t){let n=e-t;return n>=0?n:-n*Al}function Tu(e){let t=Pc(e);if(!t)return!1;for(let e=1;e<t.length;e++)if(t[e]<t[e-1])return!1;return!0}function Eu(e,t){let n=t*4,r=e.endpoints[n],i=e.endpoints[n+1],a=e.endpoints[n+2],o=e.endpoints[n+3],s=e.primitiveMeta[n],c=e.primitiveMeta[n+1],l=e.primitiveMeta[n+2],u=e.primitiveMeta[n+3],d=Math.max(0,Math.trunc(u/ul+1e-6)),f=Ku(u-d*ul);if(!Number.isFinite(r)||!Number.isFinite(i)||!Number.isFinite(s)||!Number.isFinite(c))return null;let p;if((d&ll)!==0){let t=e.primitiveBounds[n],r=e.primitiveBounds[n+1],i=e.primitiveBounds[n+2],a=e.primitiveBounds[n+3];Number.isFinite(t)&&Number.isFinite(r)&&Number.isFinite(i)&&Number.isFinite(a)&&(p={minX:t,minY:r,maxX:i,maxY:a})}return{paintOrder:Mc(e,t),paintGroup:Pc(e)?.[t],x0:r,y0:i,cx:a,cy:o,x1:s,y1:c,primitiveType:l,halfWidth:Math.max(0,e.styles[n]??0),flags:d,alpha:f,colorR:Ku(e.styles[n+1]??0),colorG:Ku(e.styles[n+2]??0),colorB:Ku(e.styles[n+3]??0),visibleBounds:p}}function Du(e,t,n,r,i=0){let a=t.x0===t.x1&&t.y0===t.y1;if(t.primitiveType!==ol||t.alpha!==1||!(t.halfWidth>0)||(t.flags&sl)!==0||a&&(t.flags&cl)===0)return!1;let o=r*Il,s=Math.floor(t.x0/o),c=Math.floor(t.y0/o);if(Math.floor(t.x1/o)!==s||Math.floor(t.y1/o)!==c)return!1;let l=t.x1<t.x0||t.x1===t.x0&&t.y1<t.y0,u=a?0:Math.round(Math.atan2(l?t.y0-t.y1:t.y1-t.y0,Math.abs(t.x1-t.x0))/dl),d=t.visibleBounds,f=e.key;f[0]=t.paintGroup??-1,f[1]=s,f[2]=c,f[3]=+!!a,f[4]=u,f[5]=t.flags,f[6]=t.halfWidth,f[7]=t.colorR,f[8]=t.colorG,f[9]=t.colorB,f[10]=+!!d,f[11]=d?d.minX:0,f[12]=d?d.minY:0,f[13]=d?d.maxX:0,f[14]=d?d.maxY:0;let p=e.find();if(!p){if(i+e.size>=Rl)return!1;p=Ou(),e.add(p)}return ku(p,t,n),!0}function Ou(){return{members:[],count:0,coincident:!0,x0:0,y0:0,x1:0,y1:0}}function ku(e,t,n){let r=t.x0,i=t.y0,a=t.x1,o=t.y1;(a<r||a===r&&o<i)&&([r,a]=[a,r],[i,o]=[o,i]),e.count>0&&(r!==e.x0/e.count||i!==e.y0/e.count||a!==e.x1/e.count||o!==e.y1/e.count)&&(e.coincident=!1),e.members.push(n),e.count++,e.x0+=r,e.y0+=i,e.x1+=a,e.y1+=o}function Au(e,t,n,r,i,a=0){if(t.coincident?t.count<2:t.count<Ll||a>=8){for(let i of t.members)Fu(n,r,Eu(e,i),i);return}if(!t.coincident&&t.count>Ll){let o=new Map,s=i*.5;for(let i of t.members){let t=Eu(e,i),a=Math.floor(t.x0/s),c=Math.floor(t.y0/s);if(Math.floor(t.x1/s)!==a||Math.floor(t.y1/s)!==c){Fu(n,r,t,i);continue}let l=`${a},${c}`,u=o.get(l);u||o.set(l,u=Ou()),ku(u,t,i)}for(let t of o.values())Au(e,t,n,r,s,a+1);return}let o=Eu(e,t.members[0]);o.x0=t.x0/t.count,o.y0=t.y0/t.count,o.x1=o.cx=t.x1/t.count,o.y1=o.cy=t.y1/t.count;let s=Eu(e,t.members[0]);if((s.x0!==s.x1||s.y0!==s.y1)&&Math.fround(o.x0)===Math.fround(o.x1)&&Math.fround(o.y0)===Math.fround(o.y1)){for(let i of t.members)Fu(n,r,Eu(e,i),i);return}for(let e=t.count;e>0;){let t=Math.min(e,zl);o.primitiveType=1-t,Fu(n,r,o,-1),e-=t}}function ju(e,t){let n=e.primitiveType>=.5,r=n?e.cx:e.x1,i=n?e.cy:e.y1;return Math.max(Math.max(e.x0,r,e.x1)-Math.min(e.x0,r,e.x1),Math.max(e.y0,i,e.y1)-Math.min(e.y0,i,e.y1))+e.halfWidth*2<=t*Pl}function Mu(e,t){let n=Math.max(Math.max(e.x0,e.cx,e.x1)-Math.min(e.x0,e.cx,e.x1),Math.max(e.y0,e.cy,e.y1)-Math.min(e.y0,e.cy,e.y1));return n<=t*Pl&&(n>0||(e.flags&cl)!==0)}function Nu(e,t,n,r){let i=e.intervals.length>>1;if(i<=0)return;e.offsetWeightSum>0&&(e.offset=e.offsetSum/e.offsetWeightSum);let a=e.intervals,o=new Uint32Array(i);for(let e=0;e<i;e+=1)o[e]=e*2;o.sort((e,t)=>a[e]-a[t]||a[e+1]-a[t+1]);let s=r*Fl,c=a[o[0]],l=a[o[0]+1];for(let r=1;r<o.length;r+=1){let i=a[o[r]],u=a[o[r]+1];if(i<=l+s){l=Math.max(l,u);continue}Pu(e,t,n,c,l),c=i,l=u}Pu(e,t,n,c,l)}function Pu(e,t,n,r,i){if(i<=r)return;let a=(e.flags&ll)!==0&&e.clipMinX<=e.clipMaxX&&e.clipMinY<=e.clipMaxY;Fu(t,n,{paintOrder:e.paintOrder,paintGroup:e.paintGroup,x0:e.axisX*r+e.normalX*e.offset,y0:e.axisY*r+e.normalY*e.offset,cx:e.axisX*i+e.normalX*e.offset,cy:e.axisY*i+e.normalY*e.offset,x1:e.axisX*i+e.normalX*e.offset,y1:e.axisY*i+e.normalY*e.offset,primitiveType:ol,halfWidth:e.halfWidth,flags:e.flags,alpha:e.alpha,colorR:e.colorR,colorG:e.colorG,colorB:e.colorB,visibleBounds:a?{minX:e.clipMinX,minY:e.clipMinY,maxX:e.clipMaxX,maxY:e.clipMaxY}:void 0},-1)}function Fu(e,t,n,r){let i=n.visibleBounds,a=i?i.minX:Math.min(n.x0,n.cx,n.x1),o=i?i.minY:Math.min(n.y0,n.cy,n.y1),s=i?i.maxX:Math.max(n.x0,n.cx,n.x1),c=i?i.maxY:Math.max(n.y0,n.cy,n.y1);e.push(n,a,o,s,c,r),t.minX=Math.min(t.minX,a),t.minY=Math.min(t.minY,o),t.maxX=Math.max(t.maxX,s),t.maxY=Math.max(t.maxY,c)}function Iu(e){let t=e.visibleBounds;return t?(t.minX+t.maxX)*.5:(e.x0+e.x1)*.5}function Lu(e){let t=e.visibleBounds;return t?(t.minY+t.maxY)*.5:(e.y0+e.y1)*.5}function Ru(e,t){let n=Math.max(1e-6,e.maxX-e.minX),r=Math.max(1e-6,e.maxY-e.minY),i=Math.max(n,r),a=Math.max(96,t*Bl),o=Ju(Math.ceil(i/a),16,96),s=n/r,c=s>=1?o:Math.max(1,Math.ceil(o*s)),l=s>=1?Math.max(1,Math.ceil(o/s)):o;return{columns:c,rows:l,tileWidth:n/c,tileHeight:r/l}}function zu(e,t,n,r){let i=Ju(Math.floor((e-n.minX)/r.tileWidth),0,r.columns-1);return Ju(Math.floor((t-n.minY)/r.tileHeight),0,r.rows-1)*r.columns+i}function Bu(){return{minX:1/0,minY:1/0,maxX:-1/0,maxY:-1/0}}function Vu(e,t){return Number.isFinite(e.minX)&&Number.isFinite(e.minY)&&Number.isFinite(e.maxX)&&Number.isFinite(e.maxY)?e:t}function Hu(e){return Number.isFinite(e)&&e>1e-8?e:1}function Uu(e){return e<=0?`exact`:`tol-${String(e).replace(`.`,`_`)}`}function Wu(){return typeof performance<`u`&&typeof performance.now==`function`?performance.now():Date.now()}function Gu(e,t,n){let r=n.map(e=>`${Uu(e.tolerance)}:${e.segmentCount}`).join(`, `);console.info(`[hepr] vector stroke LOD generated in ${e.toFixed(1)}ms (source segments: ${Math.max(0,t|0)}, levels: ${r})`)}function Ku(e){return!Number.isFinite(e)||e<=0?0:e>=1?1:e}function qu(e,t,n){return e<t?t:e>n?n:e}function Ju(e,t,n){return e<t?t:e>n?n:e}var Yu=new WeakMap,Xu=new WeakMap,Zu=new WeakMap;function Qu(e){return Yu.has(e)}function $u(e){let t=Yu.get(e);if(t)return t;let n=Zu.get(e)?.deref(),r=n?.levels[0]?.store?.literals;return!n||!r?null:ed(n.tileGrid,r,n.levels)}function ed(e,t,n){return{tileGrid:e,literals:{segmentCount:t.segmentCount,endpoints:t.endpoints,primitiveMeta:t.primitiveMeta,primitiveBounds:t.primitiveBounds,styles:t.styles},origins:Ac(t),levels:n.map(e=>({tolerance:e.tolerance,overview:e.overview,segmentCount:e.segmentCount,records:e.records,sceneBounds:e.sceneBounds,maxHalfWidth:e.maxHalfWidth,tileOffsets:e.tileOffsets,tileCounts:e.tileCounts,tileSegmentIds:e.tileSegmentIds}))}}function td(e,t){Yu.set(e,t)}function nd(e,t){let n=Object.assign(Object.defineProperties({},Object.getOwnPropertyDescriptors(e)),t.literals);kc(n,t.origins);let r={canonical:e,literals:n},i=Xu.get(t);if(!i){let e=Wl(Yl(r,0,1));i={bounds:e,allLevelBounds:Wl(rd(e,t.levels))},Xu.set(t,i)}let a=i.bounds;return{tileGrid:t.tileGrid,elapsedMs:0,allLevelBounds:i.allLevelBounds,levels:t.levels.map(e=>new Jl(r,e,e,a))}}function*rd(e,t,n=.99){let r={minX:1/0,minY:1/0,maxX:-1/0,maxY:-1/0};for(let i of t)for(let t=0;t<i.segmentCount;t++){let a=i.records?i.records[t]:t;r.minX=Math.min(r.minX,e.minX[a]),r.minY=Math.min(r.minY,e.minY[a]),r.maxX=Math.max(r.maxX,e.maxX[a]),r.maxY=Math.max(r.maxY,e.maxY[a]),t&8191||(yield{value:n,message:`Finalizing Vector LOD bounds`,yieldable:!0})}return r}async function id(e,t,n){n?.throwIfAborted();let r=new lu({yieldIntervalMs:50,shouldCancel:()=>n?.aborted??!1});await r.maybeYield(!0,0,`Restoring Vector LOD indexes`);let i=Object.assign(Object.defineProperties({},Object.getOwnPropertyDescriptors(e)),t.literals);kc(i,t.origins);let a=await Gl(Yl({canonical:e,literals:i},0,.2),r),o=[],s=67108864;for(let e=0;e<t.levels.length;e++){let n=t.levels[e],i=await Gl(Xl(n.records,n.segmentCount,a,t.tileGrid,.2+.8*e/t.levels.length,.2+.8*(e+1)/t.levels.length,s),r);s-=i.tileSegmentIds.length,o.push({...n,...i})}let c=await Gl(rd(a,o,1),r);n?.throwIfAborted();let l={...t,levels:o};return Xu.set(l,{bounds:a,allLevelBounds:c}),l}async function ad(e,t,n={}){n=Re(n);let r={},i=!!(n.withVectorLod&&t.segmentCount>0),a=!!(n.withTextLod&&t.textInstanceCount>0),o=Number(i)+Number(a);if(i){n.onProgress?.(0,`vector-lod`);let i=$u(t);if(i||=await Ql(t,{signal:n.signal,onProgress:e=>n.onProgress?.(e.value/o,`vector-lod`)}),n.signal?.throwIfAborted(),i&&=As(i,(n.vectorLodPrecision??`compact`)===`compact`),i){let a=await Ps(t,Ms(t,i),n.signal);r.vector={...sd(e,`lod-vector`,a.pointRecipes?5:4,a),precision:i.positionQuantum||i.positionQuanta?`compact`:`lossless`}}n.onProgress?.(1/o,`vector-lod`)}if(a){n.onProgress?.(Number(i)/o,`text-lod`);let a=await an(t,{signal:n.signal,onProgress:e=>n.onProgress?.((Number(i)+e.value)/o,`text-lod`)});n.signal?.throwIfAborted(),a.data&&(r.text=sd(e,`lod-text`,3,Ys(a.data,t,n.signal))),n.onProgress?.(1,`text-lod`)}return r.vector||r.text?r:void 0}async function od(e,t,n,r){if(n!==void 0){if(!n||typeof n!=`object`){console.warn(`[HEP] Invalid LOD metadata. Regenerate this HEP; LODs will be built when needed.`);return}for(let i of[`vector`,`text`]){let a=n[i];if(a!==void 0)try{r?.throwIfAborted();let n=i===`vector`?5:3;if(!Number.isInteger(a?.version)||a.version<1||a.version>n)throw Error(`stored version ${a?.version}, current version ${n}`);let o=`lod-${i}`;if(a.file!==`${o}/index.json`)throw Error(`invalid cache descriptor`);if(i===`vector`&&a.version<4&&t.segmentCount>5e4&&yc(t)&&Ec(t)){console.warn(`[HEP] Rebuilding older vector LOD for compatible composite paints; the stored hierarchy has no budget-oriented overview levels.`);continue}let s=await ld(e,o,r);if(i===`text`&&a.version===3&&B(s.textEncoding===`predictive`),i===`vector`&&a.version>=3&&B(s.tileIndexes===`rebuild`),i===`vector`&&B(a.version===5?s.pointRecipes!==void 0:s.pointRecipes===void 0),a.version>=2&&(s=i===`vector`?Ns(t,s):Xs(s,t,r)),i===`vector`)md(t,s,a.version<3),a.version>=3&&(s=await id(t,s,r)),td(t,s);else{if(a.version===1){let e=s;for(let t of[e?.runs,e?.clusters,e?.pages])if(Array.isArray(t))for(let e of t)e?.maxInkHeight===null&&e.eligible===!1&&(e.maxInkHeight=1/0)}if(a.version===1){let e=s;for(let t of[e?.clusters,e?.pages])if(Array.isArray(t))for(let e of t)e&&typeof e==`object`&&(e.inkHeightDirection??=void 0,e.baselineDirection??=void 0)}hd(t,s),sn(t,{data:s,fallbackReason:null,buildTimeMs:0})}a.version<(i===`vector`?3:n)&&console.warn(`[HEP] Using older ${i} LOD storage. Re-export or repack this HEP for smaller LOD storage; no LOD simplification is needed.`)}catch(e){r?.throwIfAborted(),console.warn(`[HEP] Ignoring ${i} LOD: ${e instanceof Error?e.message:String(e)}. Regenerate this HEP to use the latest LODs; they will be built when needed.`)}}}}function sd(e,t,n,r){let i=0,a=JSON.stringify(r,(n,r)=>{if(!(r instanceof Float32Array||r instanceof Float64Array||r instanceof Uint32Array))return r;let a=`${t}/${i++}.bin`,o=cd(r);return e.file(a,o),{array:r instanceof Float64Array?`f64`:r instanceof Float32Array?`f32`:`u32`,file:a,length:r.length}}),o=`${t}/index.json`;return e.file(o,a),{version:n,file:o}}function cd(e){let t=e.BYTES_PER_ELEMENT,n=new Uint8Array(e.byteLength),r=new DataView(new ArrayBuffer(t));for(let i=0;i<e.length;i++){e instanceof Float64Array?r.setFloat64(0,e[i],!0):e instanceof Float32Array?r.setFloat32(0,e[i],!0):r.setUint32(0,e[i],!0);for(let a=0;a<t;a++)n[a*e.length+i]=r.getUint8(a)}return n}async function ld(e,t,n){let r=e.file(`${t}/index.json`);if(!r)throw Error(`missing index`);let i=await r.async(`string`);n?.throwIfAborted();let a=JSON.parse(i),o=0;async function s(r,i){if(n?.throwIfAborted(),i>16)throw Error(`cache nesting limit exceeded`);if(!r||typeof r!=`object`)return r;let a=r;if(`array`in a){if(++o>128||![`f32`,`f64`,`u32`].includes(String(a.array))||typeof a.file!=`string`||!RegExp(`^${t}/[0-9]+\\.bin$`).test(a.file)||!Number.isSafeInteger(a.length)||Number(a.length)<0)throw Error(`invalid array descriptor`);let r=e.file(a.file);if(!r)throw Error(`missing array`);let i=await r.async(`uint8array`);n?.throwIfAborted();let s=Number(a.length),c=a.array===`f64`?8:4;if(i.length!==s*c)throw Error(`invalid array length`);let l=a.array===`f64`?new Float64Array(s):a.array===`f32`?new Float32Array(s):new Uint32Array(s),u=new DataView(new ArrayBuffer(c));for(let e=0;e<s;e++){for(let t=0;t<c;t++)u.setUint8(t,i[t*s+e]);l[e]=a.array===`f64`?u.getFloat64(0,!0):a.array===`f32`?u.getFloat32(0,!0):u.getUint32(0,!0)}return l}for(let e of Object.keys(a))a[e]&&typeof a[e]==`object`&&(a[e]=await s(a[e],i+1));return r}return s(a,0)}function B(e){if(!e)throw Error(`invalid LOD build data`)}function ud(e,t=4294967295){B(Number.isSafeInteger(e)&&e>=0&&e<=t)}function dd(e){B(e&&[e.minX,e.minY,e.maxX,e.maxY].every(Number.isFinite)&&e.minX<=e.maxX&&e.minY<=e.maxY)}function fd(e,t){B(e instanceof Float32Array&&e.length===t&&e.every(Number.isFinite))}function pd(e,t,n){B(e instanceof Uint32Array&&e.length===t),n!==void 0&&B(e.every(e=>e<n))}function md(e,t,n=!0){B(t&&t.tileGrid&&t.literals&&Array.isArray(t.levels));let r=t.tileGrid,i=t.literals;ud(r.columns,96),ud(r.rows,96),B(r.columns>0&&r.rows>0&&r.columns*r.rows<=9216),dd(r),B(Number.isFinite(r.tileWidth)&&r.tileWidth>0&&Number.isFinite(r.tileHeight)&&r.tileHeight>0);for(let[e,t,n,i]of[[r.xEdges,r.columns,r.minX,r.maxX],[r.yEdges,r.rows,r.minY,r.maxY]])B(e instanceof Float64Array&&e.length===t+1&&e[0]===n&&e[t]===i),B(e.every((t,n)=>Number.isFinite(t)&&(n===0||t>e[n-1])));ud(i.segmentCount);for(let e of[`endpoints`,`primitiveMeta`,`primitiveBounds`,`styles`])fd(i[e],i.segmentCount*4);t.origins!==void 0&&pd(t.origins,i.segmentCount,e.segmentCount),B(!e.drawRuns?.length||i.segmentCount===0||t.origins!==void 0),B(t.levels.length>0&&t.levels.length<=9);let a=r.columns*r.rows;t.levels.forEach((r,o)=>{if(ud(r.segmentCount,e.segmentCount),dd(r.sceneBounds),B(Number.isFinite(r.maxHalfWidth)&&r.maxHalfWidth>=0&&Number.isFinite(r.tolerance)&&r.tolerance>=0&&(r.overview===void 0||typeof r.overview==`boolean`)),o===0)B(r.segmentCount===e.segmentCount&&r.records===void 0&&r.tolerance===0);else if(B(r.tolerance>0),pd(r.records,r.segmentCount,e.segmentCount+i.segmentCount),t.positionQuanta)for(let n of r.records)n>=e.segmentCount&&B(t.positionQuanta[n-e.segmentCount]<=r.tolerance/32);if(n){pd(r.tileOffsets,a+1),pd(r.tileCounts,a),B(r.tileSegmentIds instanceof Uint32Array),pd(r.tileSegmentIds,r.tileSegmentIds.length,r.segmentCount),B(r.tileOffsets[0]===0&&r.tileOffsets[a]===r.tileSegmentIds.length);for(let e=0;e<a;e++)B(r.tileOffsets[e+1]===r.tileOffsets[e]+r.tileCounts[e])}})}function hd(e,t){B(t&&t.exactInstanceCount===e.textInstanceCount&&t.solidGlyphIndex===e.textGlyphCount),ud(t.coarseInstanceCount,e.textInstanceCount),B(t.combinedInstanceCount===t.exactInstanceCount+t.coarseInstanceCount);for(let e of[t.coarseInstanceA,t.coarseInstanceB,t.coarseInstanceC])fd(e,t.coarseInstanceCount*4);B(Array.isArray(t.runs)&&Array.isArray(t.clusters)&&Array.isArray(t.pages)),B(t.runs.length<=e.textInstanceCount&&t.clusters.length<=t.runs.length&&t.pages.length===e.pageCount);for(let n of[t.runs,t.clusters,t.pages]){let t=0;for(let r of n){ud(r.pageIndex,Math.max(0,e.pageCount-1)),ud(r.exactStart,e.textInstanceCount),ud(r.exactCount,e.textInstanceCount-r.exactStart),B(r.exactStart===t),t+=r.exactCount,dd(r.bounds),B((Number.isFinite(r.maxInkHeight)||r.maxInkHeight===1/0&&r.eligible===!1)&&r.maxInkHeight>=0&&typeof r.eligible==`boolean`);for(let e of[`inkHeightDirection`,`baselineDirection`]){let t=e in r?r[e]:void 0;B(t===void 0||Array.isArray(t)&&t.length===2&&t.every(Number.isFinite))}}B(t===e.textInstanceCount)}let n=0;for(let e of t.runs)B(Array.isArray(e.transform)&&e.transform.length===6&&e.transform.every(Number.isFinite)),B(e.coarseIndex===-1||e.coarseIndex===n++);B(n===t.coarseInstanceCount);let r=0,i=0;for(let e of t.clusters)B(e.runStart===r),ud(e.runCount,t.runs.length-r),B(e.runCount>0),r+=e.runCount,ud(e.coarseCount,t.coarseInstanceCount),B(e.coarseStart===-1||Number.isSafeInteger(e.coarseStart)&&e.coarseStart>=0&&e.coarseStart+e.coarseCount<=t.coarseInstanceCount);B(r===t.runs.length);for(let n of t.pages)B(n.exactStart===e.pageTextRanges[n.pageIndex*2]&&n.exactCount===e.pageTextRanges[n.pageIndex*2+1]),B(n.clusterStart===i),ud(n.clusterCount,t.clusters.length-i),i+=n.clusterCount,ud(n.coarseCount,t.coarseInstanceCount);B(i===t.clusters.length)}var gd=`annotations/annotations.json`;function _d(e,n){if(n.annotations===void 0&&n.pdfPages===void 0)return;o(n.annotationAppearances);let i=n.annotations??[];if(r(n.pdfPages,n.pageCount),t(i,{pageCount:n.pageCount,conditionCount:n.optionalContent?.conditions.length??0}),i.length===0&&!n.pdfPages?.length)return;let a=new TextEncoder().encode(JSON.stringify({version:1,annotations:i,pdfPages:n.pdfPages}));if(a.length>4294967295)throw Error(`Annotation metadata exceeds the HEP section limit.`);return e.file(gd,a),{file:gd,version:1,count:i.length,...n.annotationAppearances&&n.annotationAppearances!==`render`?{appearances:n.annotationAppearances}:{}}}async function vd(e,n,i,a){if(n===void 0)return[];let o=n;if(!o||o.file!==`annotations/annotations.json`||o.version!==1||!Number.isSafeInteger(o.count)||o.count<0||o.appearances!==void 0&&o.appearances!==`forms`&&o.appearances!==`none`)throw Error(`Invalid HEP annotation descriptor.`);a?.throwIfAborted();let s=e.file(gd);if(!s)throw Error(`Missing HEP annotation section.`);let c=await s.async(`uint8array`);if(c.length>4294967295)throw Error(`Annotation metadata exceeds the HEP section limit.`);a?.throwIfAborted();let l=JSON.parse(new TextDecoder(`utf-8`,{fatal:!0}).decode(c));if(!l||l.version!==1||!Array.isArray(l.annotations)||l.annotations.length!==o.count)throw Error(`HEP annotations do not match their manifest entry.`);return t(l.annotations,{pageCount:i.pageCount,conditionCount:i.optionalContent?.conditions.length??0}),r(l.pdfPages,i.pageCount),i.pdfPages=l.pdfPages,o.appearances!==void 0&&(i.annotationAppearances=o.appearances),l.annotations}var yd=`structure/structure.json`,bd=`structure/content-ranges.varint`;function xd(e,t){if(t.markedContent===void 0&&t.structureElements===void 0)return;C(t);let n=t.markedContent?.items??[],r=t.structureElements??[],i=new TextEncoder().encode(JSON.stringify({version:1,items:n,elements:r}));if(i.length>4294967295)throw Error(`Structure metadata exceeds the HEP section limit.`);e.file(yd,i);let a=new ts(4096),o=0;for(let e of w){let n=t.markedContent?.ranges[e]??new Uint32Array;a.writeVarUint32(n.length/3);let r=0;for(let e=0;e<n.length;e+=3)a.writeVarUint32(n[e]-r),a.writeVarUint32(n[e+1]),a.writeVarUint32(n[e+2]),r=n[e]+n[e+1];o+=n.length/3}return e.file(bd,a.toUint8Array()),{file:yd,rangesFile:bd,version:1,itemCount:n.length,elementCount:r.length,rangeCount:o}}async function Sd(e,t,n,r){if(t===void 0)return;let i=t,a=(e,t)=>Number.isSafeInteger(e)&&e>=0&&e<=t;if(!i||typeof i!=`object`||i.file!==`structure/structure.json`||i.rangesFile!==`structure/content-ranges.varint`||i.version!==1||!a(i.itemCount,E.items)||!a(i.elementCount,E.elements)||!a(i.rangeCount,E.ranges))throw Error(`Invalid HEP structure descriptor.`);let o=async t=>{r?.throwIfAborted();let n=e.file(t);if(!n)throw Error(`Missing HEP structure section.`);let i=await n.async(`uint8array`);if(i.length>4294967295)throw Error(`Structure metadata exceeds the HEP section limit.`);return r?.throwIfAborted(),i},s=JSON.parse(new TextDecoder(`utf-8`,{fatal:!0}).decode(await o(yd)));if(!s||s.version!==1||!Array.isArray(s.items)||!Array.isArray(s.elements)||s.items.length!==i.itemCount||s.elements.length!==i.elementCount)throw Error(`HEP structure does not match its manifest entry.`);let c=()=>{throw Error(`HEP structure ranges do not match the scene.`)},l=await o(bd),u=new ns(l),d={},f=0;for(let e of w){let t=u.readVarUint32();if((f+=t)>i.rangeCount&&c(),t===0)continue;t*3>l.length-u.byteOffset&&c();let r=D(n,e),a=new Uint32Array(t*3),o=0;for(let e=0;e<t;e++){let t=o+u.readVarUint32(),n=u.readVarUint32(),i=u.readVarUint32();(t+n>r||i>=s.items.length)&&c(),a.set([t,n,i],e*3),o=t+n}d[e]=a}u.expectEnd(bd),f!==i.rangeCount&&c();let p=Object.assign(Object.defineProperties({},Object.getOwnPropertyDescriptors(n)),{markedContent:s.items.length||f?{items:s.items,ranges:d}:void 0,structureElements:s.elements.length?s.elements:void 0});C(p),p.markedContent&&(n.markedContent=p.markedContent),p.structureElements&&(n.structureElements=p.structureElements)}var V={InvalidShape:`hepr.invalid-shape`,IncompatibleVersion:`hepr.incompatible-version`,InvalidNumber:`hepr.invalid-number`,InvalidCardinality:`hepr.invalid-cardinality`,InvalidOffsets:`hepr.invalid-offsets`,InvalidReference:`hepr.invalid-reference`,ResourceCycle:`hepr.resource-cycle`,ResourceLimit:`hepr.resource-limit`,DuplicatePage:`hepr.duplicate-page`},Cd=class extends Error{code;path;constructor(e,t,n){super(`${t}: ${n}`),this.name=`HeprDataValidationError`,this.code=e,this.path=t}},wd=Object.freeze({maxPages:4294967295,maxCommandsPerPage:4294967295,maxResourcesPerStore:4294967295,maxTypedArrayBytesPerPage:2**53-1,maxTextCodeUnitsPerPage:4294967295});function H(e,t,n){throw new Cd(e,t,n)}function Td(e){return typeof e==`object`&&!!e&&!Array.isArray(e)}function U(e,t){Td(e)||H(V.InvalidShape,t,`expected an object`)}function W(e,t,n){let r=Object.keys(e).sort(),i=[...t].sort();(r.length!==i.length||r.some((e,t)=>e!==i[t]))&&H(V.InvalidShape,n,`contains unknown or missing page-native fields`)}function Ed(e,t,n,r){let i=Object.keys(e),a=new Set([...t,...n]);(t.some(t=>!Object.prototype.hasOwnProperty.call(e,t))||i.some(e=>!a.has(e)))&&H(V.InvalidShape,r,`contains unknown or missing page-native fields`)}function G(e,t,n){e instanceof t||H(V.InvalidShape,n,`expected ${t.name}`)}function Dd(e,t,n=0){(!Number.isSafeInteger(e)||e<n)&&H(V.InvalidNumber,t,`expected a safe integer >= ${n}`)}function Od(e,t){Number.isFinite(e)||H(V.InvalidNumber,t,`expected a finite number`)}function K(e,t){for(let n=0;n<e.length;n+=1)Number.isFinite(e[n])||H(V.InvalidNumber,`${t}[${n}]`,`expected a finite number`)}function q(e,t,n){e!==t&&H(V.InvalidCardinality,n,`expected length ${t}, received ${e}`)}function kd(e,t,n){e%t!==0&&H(V.InvalidCardinality,n,`length ${e} is not divisible by ${t}`)}function Ad(e,t,n,r){q(e.length,t+1,r),e[0]!==0&&H(V.InvalidOffsets,`${r}[0]`,`must be zero`);for(let t=1;t<e.length;t+=1)e[t]<e[t-1]&&H(V.InvalidOffsets,`${r}[${t}]`,`must be monotonic`);e[e.length-1]!==n&&H(V.InvalidOffsets,`${r}[${e.length-1}]`,`must equal payload length ${n}`)}function J(e,t,n){(!Number.isSafeInteger(e)||e<-1||e>=t)&&H(V.InvalidReference,n,`expected -1 or an index below ${t}, received ${e}`)}function jd(e,t,n){(!Number.isSafeInteger(e)||e<0||e>=t)&&H(V.InvalidReference,n,`expected an index below ${t}, received ${e}`)}function Md(e,t,n,r){Dd(e,`${r}.first`),Dd(t,`${r}.count`,1),e+t>n&&H(V.InvalidReference,r,`range [${e}, ${e+t}) exceeds store length ${n}`)}function Nd(e,t){(!Array.isArray(e)||e.length!==4)&&H(V.InvalidShape,t,`expected a four-number tuple`),e.forEach((e,n)=>Od(e,`${t}[${n}]`)),(e[0]>e[2]||e[1]>e[3])&&H(V.InvalidNumber,t,`rectangle is not normalized`)}function Pd(e,t){U(e,t),W(e,[`sourcePageIndex`,`mediaBox`,`cropBox`,`bleedBox`,`trimBox`,`artBox`,`rotation`,`userUnit`,`width`,`height`],t),Dd(e.sourcePageIndex,`${t}.sourcePageIndex`),Nd(e.mediaBox,`${t}.mediaBox`),Nd(e.cropBox,`${t}.cropBox`),e.bleedBox!==null&&Nd(e.bleedBox,`${t}.bleedBox`),e.trimBox!==null&&Nd(e.trimBox,`${t}.trimBox`),e.artBox!==null&&Nd(e.artBox,`${t}.artBox`),e.rotation!==0&&e.rotation!==90&&e.rotation!==180&&e.rotation!==270&&H(V.InvalidNumber,`${t}.rotation`,`expected 0, 90, 180, or 270`),Od(e.userUnit,`${t}.userUnit`),Od(e.width,`${t}.width`),Od(e.height,`${t}.height`),(e.userUnit<=0||e.width<=0||e.height<=0)&&H(V.InvalidNumber,t,`userUnit, width, and height must be positive`)}function Fd(e,t){Array.isArray(e)||H(V.InvalidShape,t,`expected an array`),e.forEach((e,n)=>{let r=`${t}[${n}]`;U(e,r),Ed(e,[`code`,`severity`,`message`],[`offset`,`objectNumber`,`pageIndex`,`details`],r),(typeof e.code!=`string`||e.code.length===0)&&H(V.InvalidShape,`${r}.code`,`expected a code`),e.severity!==`info`&&e.severity!==`warning`&&e.severity!==`error`&&H(V.InvalidShape,`${r}.severity`,`expected info, warning, or error`),typeof e.message!=`string`&&H(V.InvalidShape,`${r}.message`,`expected a string`);for(let t of[`offset`,`objectNumber`,`pageIndex`]){let n=e[t];n!==void 0&&(typeof n!=`number`||!Number.isSafeInteger(n)||n<0)&&H(V.InvalidNumber,`${r}.${t}`,`expected a nonnegative safe integer`)}if(e.details!==void 0){U(e.details,`${r}.details`);for(let[t,n]of Object.entries(e.details))n!==null&&typeof n!=`string`&&typeof n!=`number`&&typeof n!=`boolean`&&H(V.InvalidShape,`${r}.details.${t}`,`expected a string, number, boolean, or null`),typeof n==`number`&&!Number.isFinite(n)&&H(V.InvalidNumber,`${r}.details.${t}`,`expected a finite number`)}})}function Id(e,t,n){e>t.maxResourcesPerStore&&H(V.ResourceLimit,n,`${e} resources exceed limit ${t.maxResourcesPerStore}`)}function Ld(e,t,n){U(e,n),W(e,[`transforms`,`paths`,`strokes`,`glyphs`,`fonts`,`images`,`meshes`,`functions`,`gradients`,`patterns`,`clips`,`colors`,`paints`,`optionalContent`,`markedContent`],n);let r=e.transforms;U(r,`${n}.transforms`),W(r,[`values`],`${n}.transforms`),G(r.values,Float32Array,`${n}.transforms.values`),kd(r.values.length,6,`${n}.transforms.values`),K(r.values,`${n}.transforms.values`);let i=r.values.length/6;i===0&&H(V.InvalidCardinality,`${n}.transforms.values`,`at least the identity transform is required`);let a=e.paths;U(a,`${n}.paths`),W(a,[`pathVerbOffsets`,`verbs`,`verbCoordinateOffsets`,`coordinates`,`bounds`,`flags`,`fillPathMetaA`,`fillPathMetaB`,`fillPathMetaC`,`fillSegmentsA`,`fillSegmentsB`],`${n}.paths`),G(a.pathVerbOffsets,Uint32Array,`${n}.paths.pathVerbOffsets`),G(a.verbs,Uint8Array,`${n}.paths.verbs`),G(a.verbCoordinateOffsets,Uint32Array,`${n}.paths.verbCoordinateOffsets`),G(a.coordinates,Float32Array,`${n}.paths.coordinates`),G(a.bounds,Float32Array,`${n}.paths.bounds`),G(a.flags,Uint8Array,`${n}.paths.flags`);let o=Math.max(0,a.pathVerbOffsets.length-1);Ad(a.pathVerbOffsets,o,a.verbs.length,`${n}.paths.pathVerbOffsets`),Ad(a.verbCoordinateOffsets,a.verbs.length,a.coordinates.length,`${n}.paths.verbCoordinateOffsets`),q(a.bounds.length,o*4,`${n}.paths.bounds`),q(a.flags.length,o,`${n}.paths.flags`),K(a.coordinates,`${n}.paths.coordinates`),K(a.bounds,`${n}.paths.bounds`);for(let e=0;e<o;e+=1){let t=e*4;(a.bounds[t+2]<a.bounds[t]||a.bounds[t+3]<a.bounds[t+1])&&H(V.InvalidNumber,`${n}.paths.bounds[${t}]`,`inverted path bounds`),(a.flags[e]&~(be.Closed|be.Rectangle))!==0&&H(V.InvalidNumber,`${n}.paths.flags[${e}]`,`unknown path flag`)}let s=[2,2,4,6,0];for(let e=0;e<a.verbs.length;e+=1){let t=a.verbs[e];t>De.Close&&H(V.InvalidNumber,`${n}.paths.verbs[${e}]`,`unknown verb`),a.verbCoordinateOffsets[e+1]-a.verbCoordinateOffsets[e]!==s[t]&&H(V.InvalidCardinality,`${n}.paths.verbCoordinateOffsets[${e}]`,`verb ${t} requires ${s[t]} coordinates`)}G(a.fillPathMetaA,Float32Array,`${n}.paths.fillPathMetaA`),G(a.fillPathMetaB,Float32Array,`${n}.paths.fillPathMetaB`),G(a.fillPathMetaC,Float32Array,`${n}.paths.fillPathMetaC`),G(a.fillSegmentsA,Float32Array,`${n}.paths.fillSegmentsA`),G(a.fillSegmentsB,Float32Array,`${n}.paths.fillSegmentsB`),kd(a.fillPathMetaA.length,4,`${n}.paths.fillPathMetaA`),q(a.fillPathMetaB.length,a.fillPathMetaA.length,`${n}.paths.fillPathMetaB`),q(a.fillPathMetaC.length,a.fillPathMetaA.length,`${n}.paths.fillPathMetaC`),kd(a.fillSegmentsA.length,4,`${n}.paths.fillSegmentsA`),q(a.fillSegmentsB.length,a.fillSegmentsA.length,`${n}.paths.fillSegmentsB`),K(a.fillPathMetaA,`${n}.paths.fillPathMetaA`),K(a.fillPathMetaB,`${n}.paths.fillPathMetaB`),K(a.fillPathMetaC,`${n}.paths.fillPathMetaC`),K(a.fillSegmentsA,`${n}.paths.fillSegmentsA`),K(a.fillSegmentsB,`${n}.paths.fillSegmentsB`);let c=a.fillPathMetaA.length/4,l=e.strokes;U(l,`${n}.strokes`),W(l,[`endpoints`,`primitiveMeta`,`primitiveBounds`,`styles`,`lineWidths`,`miterLimits`,`lineCaps`,`lineJoins`,`flags`,`dashOffsets`,`dashValues`,`dashPhases`],`${n}.strokes`);for(let[e,t]of[[`endpoints`,l.endpoints],[`primitiveMeta`,l.primitiveMeta],[`primitiveBounds`,l.primitiveBounds],[`styles`,l.styles]])G(t,Float32Array,`${n}.strokes.${e}`),kd(t.length,4,`${n}.strokes.${e}`),K(t,`${n}.strokes.${e}`);q(l.primitiveMeta.length,l.endpoints.length,`${n}.strokes.primitiveMeta`),q(l.primitiveBounds.length,l.endpoints.length,`${n}.strokes.primitiveBounds`),q(l.styles.length,l.endpoints.length,`${n}.strokes.styles`);let u=l.endpoints.length/4;for(let[e,t,r]of[[`lineWidths`,l.lineWidths,Float32Array],[`miterLimits`,l.miterLimits,Float32Array],[`lineCaps`,l.lineCaps,Uint8Array],[`lineJoins`,l.lineJoins,Uint8Array],[`flags`,l.flags,Uint8Array],[`dashPhases`,l.dashPhases,Float32Array]])G(t,r,`${n}.strokes.${e}`);let d=l.lineWidths.length;q(l.miterLimits.length,d,`${n}.strokes.miterLimits`),q(l.lineCaps.length,d,`${n}.strokes.lineCaps`),q(l.lineJoins.length,d,`${n}.strokes.lineJoins`),q(l.flags.length,d,`${n}.strokes.flags`),q(l.dashPhases.length,d,`${n}.strokes.dashPhases`),G(l.dashOffsets,Uint32Array,`${n}.strokes.dashOffsets`),G(l.dashValues,Float32Array,`${n}.strokes.dashValues`),Ad(l.dashOffsets,d,l.dashValues.length,`${n}.strokes.dashOffsets`),K(l.lineWidths,`${n}.strokes.lineWidths`),K(l.miterLimits,`${n}.strokes.miterLimits`),K(l.dashValues,`${n}.strokes.dashValues`),K(l.dashPhases,`${n}.strokes.dashPhases`);for(let e=0;e<d;e+=1){l.lineWidths[e]<0&&H(V.InvalidNumber,`${n}.strokes.lineWidths[${e}]`,`negative line width`),l.miterLimits[e]<1&&H(V.InvalidNumber,`${n}.strokes.miterLimits[${e}]`,`miter limit below one`),(l.lineCaps[e]>2||l.lineJoins[e]>2)&&H(V.InvalidNumber,`${n}.strokes.lineCaps[${e}]`,`unknown cap or join`),(l.flags[e]&~(Se.Hairline|Se.StrokeAdjust))!==0&&H(V.InvalidNumber,`${n}.strokes.flags[${e}]`,`unknown stroke flag`),(l.flags[e]&Se.Hairline)!==0!=(l.lineWidths[e]===0)&&H(V.InvalidNumber,`${n}.strokes.flags[${e}]`,`hairline flag and width disagree`);let t=l.dashOffsets[e],r=l.dashOffsets[e+1],i=0;for(let e=t;e<r;e+=1)l.dashValues[e]<0&&H(V.InvalidNumber,`${n}.strokes.dashValues[${e}]`,`negative dash length`),i+=l.dashValues[e];r>t&&i===0&&H(V.InvalidNumber,`${n}.strokes.dashOffsets[${e}]`,`all-zero dash array`)}let f=e.glyphs;U(f,`${n}.glyphs`),W(f,[`fontIndices`,`characterCodes`,`glyphIds`,`transformIndices`,`advances`,`flags`],`${n}.glyphs`),G(f.fontIndices,Uint32Array,`${n}.glyphs.fontIndices`);let p=f.fontIndices.length;for(let[e,t,r,i]of[[`characterCodes`,f.characterCodes,Uint32Array,1],[`glyphIds`,f.glyphIds,Uint32Array,1],[`transformIndices`,f.transformIndices,Uint32Array,1],[`advances`,f.advances,Float32Array,2],[`flags`,f.flags,Uint8Array,1]])G(t,r,`${n}.glyphs.${e}`),q(t.length,p*i,`${n}.glyphs.${e}`);K(f.advances,`${n}.glyphs.advances`);let m=e.fonts;U(m,`${n}.fonts`),W(m,[`names`,`kinds`,`unitsPerEm`,`ascents`,`descents`,`glyphOffsets`,`glyphIds`,`outlinePathStarts`,`outlinePathCounts`,`type3ProgramIndices`],`${n}.fonts`),(!Array.isArray(m.names)||m.names.some(e=>typeof e!=`string`))&&H(V.InvalidShape,`${n}.fonts.names`,`expected strings`),G(m.kinds,Uint8Array,`${n}.fonts.kinds`);let h=m.names.length;for(let[e,t,r]of[[`kinds`,m.kinds,Uint8Array],[`unitsPerEm`,m.unitsPerEm,Uint32Array],[`ascents`,m.ascents,Float32Array],[`descents`,m.descents,Float32Array]])G(t,r,`${n}.fonts.${e}`),q(t.length,h,`${n}.fonts.${e}`);G(m.glyphOffsets,Uint32Array,`${n}.fonts.glyphOffsets`),G(m.glyphIds,Uint32Array,`${n}.fonts.glyphIds`),Ad(m.glyphOffsets,h,m.glyphIds.length,`${n}.fonts.glyphOffsets`);for(let[e,t,r]of[[`outlinePathStarts`,m.outlinePathStarts,Uint32Array],[`outlinePathCounts`,m.outlinePathCounts,Uint32Array],[`type3ProgramIndices`,m.type3ProgramIndices,Int32Array]])G(t,r,`${n}.fonts.${e}`),q(t.length,m.glyphIds.length,`${n}.fonts.${e}`);K(m.ascents,`${n}.fonts.ascents`),K(m.descents,`${n}.fonts.descents`);for(let e=0;e<h;e+=1)m.kinds[e]>Oe.Type3&&H(V.InvalidNumber,`${n}.fonts.kinds[${e}]`,`unknown font kind`),m.unitsPerEm[e]===0&&H(V.InvalidNumber,`${n}.fonts.unitsPerEm[${e}]`,`font units-per-em must be positive`);for(let e=0;e<p;e+=1){let t=f.fontIndices[e];jd(t,h,`${n}.glyphs.fontIndices[${e}]`),jd(f.transformIndices[e],i,`${n}.glyphs.transformIndices[${e}]`);let r=L.Invisible|L.ClipOnly|L.Vertical|L.Type3;(f.flags[e]&~r)!==0&&H(V.InvalidNumber,`${n}.glyphs.flags[${e}]`,`unknown glyph flag`);let a=(f.flags[e]&L.Type3)!==0;a!==(m.kinds[t]===Oe.Type3)&&H(V.InvalidReference,`${n}.glyphs.flags[${e}]`,`Type3 glyph flag and font kind disagree`);let o=m.glyphOffsets[t],s=m.glyphOffsets[t+1],c=f.glyphIds[e],l=o,u=s;for(;l<u;){let e=l+(u-l>>1);m.glyphIds[e]<c?l=e+1:u=e}(l>=s||m.glyphIds[l]!==c)&&H(V.InvalidReference,`${n}.glyphs.glyphIds[${e}]`,`glyph instance has no self-contained font record`);let d=(f.flags[e]&L.Invisible)!==0;a&&!d&&m.type3ProgramIndices[l]<0&&H(V.InvalidReference,`${n}.fonts.type3ProgramIndices[${l}]`,`visible Type3 glyph has no self-contained CharProc program`)}for(let e=0;e<m.glyphIds.length;e+=1)m.outlinePathStarts[e]+m.outlinePathCounts[e]>o&&H(V.InvalidReference,`${n}.fonts.outlinePathStarts[${e}]`,`outline path span exceeds the path store`);for(let e=0;e<h;e+=1){let t=m.glyphOffsets[e],r=m.glyphOffsets[e+1],i=m.kinds[e]===Oe.Type3;for(let e=t+1;e<r;e+=1)m.glyphIds[e-1]>=m.glyphIds[e]&&H(V.InvalidNumber,`${n}.fonts.glyphIds[${e}]`,`font glyph identifiers must be strictly increasing`);for(let e=t;e<r;e+=1)!i&&m.type3ProgramIndices[e]>=0&&H(V.InvalidReference,`${n}.fonts.type3ProgramIndices[${e}]`,`ordinary outline glyph references a Type3 program`),i&&m.outlinePathCounts[e]!==0&&H(V.InvalidReference,`${n}.fonts.outlinePathCounts[${e}]`,`Type3 glyph paint must be retained as a reusable program`)}let g=e.images;U(g,`${n}.images`),W(g,[`widths`,`heights`,`bitsPerComponent`,`formats`,`colorSpaceIndices`,`interpolate`,`imageMask`,`softMaskImageIndices`,`colorKeyMaskOffsets`,`colorKeyMaskValues`,`decodeOffsets`,`decodeValues`,`matteOffsets`,`matteValues`,`dataOffsets`,`data`],`${n}.images`),G(g.widths,Uint32Array,`${n}.images.widths`);let _=g.widths.length;for(let[e,t,r]of[[`heights`,g.heights,Uint32Array],[`bitsPerComponent`,g.bitsPerComponent,Uint8Array],[`formats`,g.formats,Uint8Array],[`colorSpaceIndices`,g.colorSpaceIndices,Int32Array],[`interpolate`,g.interpolate,Uint8Array],[`imageMask`,g.imageMask,Uint8Array],[`softMaskImageIndices`,g.softMaskImageIndices,Int32Array]])G(t,r,`${n}.images.${e}`),q(t.length,_,`${n}.images.${e}`);G(g.colorKeyMaskOffsets,Uint32Array,`${n}.images.colorKeyMaskOffsets`),G(g.colorKeyMaskValues,Int32Array,`${n}.images.colorKeyMaskValues`),G(g.decodeOffsets,Uint32Array,`${n}.images.decodeOffsets`),G(g.decodeValues,Float32Array,`${n}.images.decodeValues`),G(g.matteOffsets,Uint32Array,`${n}.images.matteOffsets`),G(g.matteValues,Float32Array,`${n}.images.matteValues`),G(g.dataOffsets,Uint32Array,`${n}.images.dataOffsets`),G(g.data,Uint8Array,`${n}.images.data`),Ad(g.colorKeyMaskOffsets,_,g.colorKeyMaskValues.length,`${n}.images.colorKeyMaskOffsets`),Ad(g.decodeOffsets,_,g.decodeValues.length,`${n}.images.decodeOffsets`),Ad(g.matteOffsets,_,g.matteValues.length,`${n}.images.matteOffsets`),Ad(g.dataOffsets,_,g.data.length,`${n}.images.dataOffsets`),K(g.decodeValues,`${n}.images.decodeValues`),K(g.matteValues,`${n}.images.matteValues`);for(let e=0;e<_;e+=1){(g.widths[e]===0||g.heights[e]===0)&&H(V.InvalidNumber,`${n}.images[${e}]`,`dimensions must be positive`),g.formats[e]>ke.Gray1&&H(V.InvalidNumber,`${n}.images.formats[${e}]`,`unknown format`);let t=g.bitsPerComponent[e];![1,2,4,8,16].includes(t)&&(t!==0||g.formats[e]!==ke.Jpeg2000)&&H(V.InvalidNumber,`${n}.images.bitsPerComponent[${e}]`,`unsupported image component precision`),(g.interpolate[e]>1||g.imageMask[e]>1)&&H(V.InvalidNumber,`${n}.images[${e}]`,`image flags must be zero or one`),J(g.softMaskImageIndices[e],_,`${n}.images.softMaskImageIndices[${e}]`);let r=g.dataOffsets[e+1]-g.dataOffsets[e];if(g.formats[e]===ke.Gray8||g.formats[e]===ke.GrayAlpha8||g.formats[e]===ke.Rgba8||g.formats[e]===ke.Rgba16||g.formats[e]===ke.Gray1){let t=je(g.formats[e],g.widths[e],g.heights[e]);(!Number.isSafeInteger(t)||r!==t)&&H(V.InvalidCardinality,`${n}.images.dataOffsets[${e}]`,`raw image payload must contain exactly ${t} bytes`)}else r===0&&H(V.InvalidCardinality,`${n}.images.dataOffsets[${e}]`,`encoded image payload must not be empty`)}Rd(g.softMaskImageIndices,`${n}.images.softMaskImageIndices`);let v=e.meshes;U(v,`${n}.meshes`),W(v,[`kinds`,`vertexOffsets`,`indexOffsets`,`positions`,`colors`,`indices`,`colorSpaceIndices`],`${n}.meshes`),G(v.kinds,Uint8Array,`${n}.meshes.kinds`);let y=v.kinds.length;G(v.vertexOffsets,Uint32Array,`${n}.meshes.vertexOffsets`),G(v.indexOffsets,Uint32Array,`${n}.meshes.indexOffsets`),G(v.positions,Float32Array,`${n}.meshes.positions`),G(v.colors,Float32Array,`${n}.meshes.colors`),G(v.indices,Uint32Array,`${n}.meshes.indices`),G(v.colorSpaceIndices,Int32Array,`${n}.meshes.colorSpaceIndices`),kd(v.positions.length,2,`${n}.meshes.positions`);let b=v.positions.length/2;q(v.colors.length,b*4,`${n}.meshes.colors`),Ad(v.vertexOffsets,y,b,`${n}.meshes.vertexOffsets`),Ad(v.indexOffsets,y,v.indices.length,`${n}.meshes.indexOffsets`),q(v.colorSpaceIndices.length,y,`${n}.meshes.colorSpaceIndices`),K(v.positions,`${n}.meshes.positions`),K(v.colors,`${n}.meshes.colors`);for(let e=0;e<y;e+=1){let t=v.kinds[e],r=v.vertexOffsets[e],i=v.vertexOffsets[e+1],a=v.indexOffsets[e],o=v.indexOffsets[e+1],s=i-r,c=o-a;for(let e=a;e<o;e+=1)(v.indices[e]<r||v.indices[e]>=i)&&H(V.InvalidReference,`${n}.meshes.indices[${e}]`,`vertex index is outside its mesh`);if(t===Ae.Triangles){kd(c,3,`${n}.meshes.indices[${e}]`);continue}let l=t===Ae.CoonsPatch?12:t===Ae.TensorPatch?16:0;l===0&&H(V.InvalidNumber,`${n}.meshes.kinds[${e}]`,`unknown mesh kind`),s===0&&H(V.InvalidCardinality,`${n}.meshes.vertexOffsets[${e}]`,`a patch mesh must contain at least one complete patch`),kd(s,l,`${n}.meshes.vertexOffsets[${e}]`),q(c,s,`${n}.meshes.indexOffsets[${e}]`);for(let e=0;e<c;e+=1){let t=a+e;v.indices[t]!==r+e&&H(V.InvalidReference,`${n}.meshes.indices[${t}]`,`patch controls must retain source order`);let i=e%l;if(i===0||i===3||i===6||i===9)continue;let o=(r+e)*4;(v.colors[o]!==0||v.colors[o+1]!==0||v.colors[o+2]!==0||v.colors[o+3]!==0)&&H(V.InvalidNumber,`${n}.meshes.colors[${o}]`,`non-corner patch controls must have zero color payloads`)}}let x=e.functions;U(x,`${n}.functions`),W(x,[`kinds`,`domainOffsets`,`domains`,`rangeOffsets`,`ranges`,`parameterOffsets`,`parameters`,`sampleOffsets`,`samples`,`calculatorOffsets`,`calculatorBytecode`],`${n}.functions`),G(x.kinds,Uint8Array,`${n}.functions.kinds`);let S=x.kinds.length;for(let[e,t,r,i]of[[`domainOffsets`,`domains`,x.domains,Float32Array],[`rangeOffsets`,`ranges`,x.ranges,Float32Array],[`parameterOffsets`,`parameters`,x.parameters,Float32Array],[`sampleOffsets`,`samples`,x.samples,Float32Array],[`calculatorOffsets`,`calculatorBytecode`,x.calculatorBytecode,Uint8Array]]){let a=x[e];G(a,Uint32Array,`${n}.functions.${e}`),G(r,i,`${n}.functions.${t}`),Ad(a,S,r.length,`${n}.functions.${e}`),r instanceof Float32Array&&K(r,`${n}.functions.${t}`)}for(let e=0;e<S;e+=1){let t=x.kinds[e];t!==Ce.Sampled&&t!==Ce.Exponential&&t!==Ce.Stitching&&t!==Ce.Calculator&&H(V.InvalidNumber,`${n}.functions.kinds[${e}]`,`unknown PDF function kind`)}let C=e.gradients;U(C,`${n}.gradients`),W(C,[`kinds`,`colorSpaceIndices`,`functionIndices`,`coordinateOffsets`,`coordinates`,`stopOffsets`,`stopPositions`,`stopPaintIndices`,`meshIndices`,`extendFlags`],`${n}.gradients`),G(C.kinds,Uint8Array,`${n}.gradients.kinds`);let w=C.kinds.length;for(let[e,t,r]of[[`colorSpaceIndices`,C.colorSpaceIndices,Int32Array],[`functionIndices`,C.functionIndices,Int32Array],[`meshIndices`,C.meshIndices,Int32Array],[`extendFlags`,C.extendFlags,Uint8Array]])G(t,r,`${n}.gradients.${e}`),q(t.length,w,`${n}.gradients.${e}`);G(C.coordinateOffsets,Uint32Array,`${n}.gradients.coordinateOffsets`),G(C.coordinates,Float32Array,`${n}.gradients.coordinates`),G(C.stopOffsets,Uint32Array,`${n}.gradients.stopOffsets`),G(C.stopPositions,Float32Array,`${n}.gradients.stopPositions`),G(C.stopPaintIndices,Uint32Array,`${n}.gradients.stopPaintIndices`),Ad(C.coordinateOffsets,w,C.coordinates.length,`${n}.gradients.coordinateOffsets`),Ad(C.stopOffsets,w,C.stopPositions.length,`${n}.gradients.stopOffsets`),q(C.stopPaintIndices.length,C.stopPositions.length,`${n}.gradients.stopPaintIndices`),K(C.coordinates,`${n}.gradients.coordinates`),K(C.stopPositions,`${n}.gradients.stopPositions`);let T=e.patterns;U(T,`${n}.patterns`),W(T,[`kinds`,`paintTypes`,`tilingTypes`,`bounds`,`xSteps`,`ySteps`,`matrixIndices`,`programIndices`,`gradientIndices`,`underlyingColorSpaceIndices`],`${n}.patterns`),G(T.kinds,Uint8Array,`${n}.patterns.kinds`);let E=T.kinds.length;for(let[e,t,r,i]of[[`paintTypes`,T.paintTypes,Uint8Array,1],[`tilingTypes`,T.tilingTypes,Uint8Array,1],[`bounds`,T.bounds,Float32Array,4],[`xSteps`,T.xSteps,Float32Array,1],[`ySteps`,T.ySteps,Float32Array,1],[`matrixIndices`,T.matrixIndices,Uint32Array,1],[`programIndices`,T.programIndices,Int32Array,1],[`gradientIndices`,T.gradientIndices,Int32Array,1],[`underlyingColorSpaceIndices`,T.underlyingColorSpaceIndices,Int32Array,1]])G(t,r,`${n}.patterns.${e}`),q(t.length,E*i,`${n}.patterns.${e}`);K(T.bounds,`${n}.patterns.bounds`),K(T.xSteps,`${n}.patterns.xSteps`),K(T.ySteps,`${n}.patterns.ySteps`);for(let e=0;e<E;e+=1){jd(T.matrixIndices[e],i,`${n}.patterns.matrixIndices[${e}]`);let t=T.kinds[e];t!==we.ColoredTiling&&t!==we.UncoloredTiling&&t!==we.Shading&&H(V.InvalidNumber,`${n}.patterns.kinds[${e}]`,`unknown pattern kind`),(t===we.ColoredTiling&&T.paintTypes[e]!==1||t===we.UncoloredTiling&&T.paintTypes[e]!==2)&&H(V.InvalidNumber,`${n}.patterns.paintTypes[${e}]`,`tiling-pattern kind and PaintType disagree`)}let D=e.clips;U(D,`${n}.clips`),W(D,[`parentIndices`,`firstPaths`,`pathCounts`,`firstGlyphs`,`glyphCounts`,`fillRules`,`transformIndices`],`${n}.clips`),G(D.parentIndices,Int32Array,`${n}.clips.parentIndices`);let O=D.parentIndices.length;for(let[e,t,r]of[[`firstPaths`,D.firstPaths,Uint32Array],[`pathCounts`,D.pathCounts,Uint32Array],[`firstGlyphs`,D.firstGlyphs,Uint32Array],[`glyphCounts`,D.glyphCounts,Uint32Array],[`fillRules`,D.fillRules,Uint8Array],[`transformIndices`,D.transformIndices,Uint32Array]])G(t,r,`${n}.clips.${e}`),q(t.length,O,`${n}.clips.${e}`);let k=new Uint8Array(p);for(let e=0;e<O;e+=1){J(D.parentIndices[e],O,`${n}.clips.parentIndices[${e}]`),D.parentIndices[e]>=e&&H(V.InvalidReference,`${n}.clips.parentIndices[${e}]`,`persistent clip parent must precede its child`),D.firstPaths[e]+D.pathCounts[e]>o&&H(V.InvalidReference,`${n}.clips.firstPaths[${e}]`,`path span is out of range`),D.firstGlyphs[e]+D.glyphCounts[e]>p&&H(V.InvalidReference,`${n}.clips.firstGlyphs[${e}]`,`glyph span is out of range`);let t=D.pathCounts[e]>0,r=D.glyphCounts[e]>0;if(t&&r&&H(V.InvalidReference,`${n}.clips.pathCounts[${e}]`,`clip node cannot mix path and glyph unions`),r&&D.fillRules[e]!==0&&H(V.InvalidNumber,`${n}.clips.fillRules[${e}]`,`glyph clipping unions use the nonzero fill rule`),r){let t=D.firstGlyphs[e],r=t+D.glyphCounts[e];for(let i=t;i<r;i+=1){let t=f.flags[i];(t&L.ClipOnly)===0&&H(V.InvalidReference,`${n}.clips.firstGlyphs[${e}]`,`text clip references a glyph without the clipping flag`),(t&L.Type3)!==0&&H(V.InvalidReference,`${n}.clips.firstGlyphs[${e}]`,`Type3 glyph clipping has no exact outline contract`),k[i]!==0&&H(V.InvalidReference,`${n}.clips.firstGlyphs[${e}]`,`clipping glyph is referenced by more than one text clip`),k[i]=1;let r=f.fontIndices[i],a=f.glyphIds[i],o=m.glyphOffsets[r],s=m.glyphOffsets[r+1],c=o,l=s;for(;c<l;){let e=c+(l-c>>1);m.glyphIds[e]<a?c=e+1:l=e}(c>=s||m.glyphIds[c]!==a)&&H(V.InvalidReference,`${n}.clips.firstGlyphs[${e}]`,`clipping glyph has no font-outline record`)}}jd(D.transformIndices[e],i,`${n}.clips.transformIndices[${e}]`),D.fillRules[e]>1&&H(V.InvalidNumber,`${n}.clips.fillRules[${e}]`,`unknown fill rule`)}for(let e=0;e<p;e+=1)(f.flags[e]&L.ClipOnly)!==0!=(k[e]!==0)&&H(V.InvalidReference,`${n}.glyphs.flags[${e}]`,`clipping glyph must belong to exactly one persistent text clip`);Rd(D.parentIndices,`${n}.clips.parentIndices`);let A=e.colors;U(A,`${n}.colors`),W(A,[`spaceKinds`,`componentCounts`,`alternateSpaceIndices`,`functionIndices`,`parameterOffsets`,`parameters`,`nameOffsets`,`names`,`profileOffsets`,`profiles`,`lookupOffsets`,`lookupBytes`,`iccModes`,`iccTransformOffsets`,`iccTransformSamples`],`${n}.colors`),G(A.spaceKinds,Uint8Array,`${n}.colors.spaceKinds`);let j=A.spaceKinds.length;for(let[e,t,r]of[[`componentCounts`,A.componentCounts,Uint8Array],[`alternateSpaceIndices`,A.alternateSpaceIndices,Int32Array],[`functionIndices`,A.functionIndices,Int32Array],[`iccModes`,A.iccModes,Uint8Array]])G(t,r,`${n}.colors.${e}`),q(t.length,j,`${n}.colors.${e}`);(!Array.isArray(A.names)||A.names.some(e=>typeof e!=`string`))&&H(V.InvalidShape,`${n}.colors.names`,`expected strings`);for(let[e,t,r,i]of[[`parameterOffsets`,`parameters`,A.parameters,Float32Array],[`profileOffsets`,`profiles`,A.profiles,Uint8Array],[`lookupOffsets`,`lookupBytes`,A.lookupBytes,Uint8Array],[`iccTransformOffsets`,`iccTransformSamples`,A.iccTransformSamples,Uint8Array]]){let a=A[e];G(a,Uint32Array,`${n}.colors.${e}`),G(r,i,`${n}.colors.${t}`),Ad(a,j,r.length,`${n}.colors.${e}`)}G(A.nameOffsets,Uint32Array,`${n}.colors.nameOffsets`),Ad(A.nameOffsets,j,A.names.length,`${n}.colors.nameOffsets`),K(A.parameters,`${n}.colors.parameters`);let M=e.paints;U(M,`${n}.paints`),W(M,[`kinds`,`resourceIndices`,`alphas`,`overprint`,`overprintModes`,`patternTransformIndices`,`patternBasePaintIndices`],`${n}.paints`),G(M.kinds,Uint8Array,`${n}.paints.kinds`);let N=M.kinds.length;for(let[e,t,r]of[[`resourceIndices`,M.resourceIndices,Uint32Array],[`alphas`,M.alphas,Float32Array],[`overprint`,M.overprint,Uint8Array],[`overprintModes`,M.overprintModes,Uint8Array],[`patternTransformIndices`,M.patternTransformIndices,Int32Array],[`patternBasePaintIndices`,M.patternBasePaintIndices,Int32Array]])G(t,r,`${n}.paints.${e}`),q(t.length,N,`${n}.paints.${e}`);K(M.alphas,`${n}.paints.alphas`);let P=e.optionalContent;U(P,`${n}.optionalContent`),W(P,[`names`,`defaultVisible`],`${n}.optionalContent`),(!Array.isArray(P.names)||P.names.some(e=>typeof e!=`string`))&&H(V.InvalidShape,`${n}.optionalContent.names`,`expected strings`),G(P.defaultVisible,Uint8Array,`${n}.optionalContent.defaultVisible`);let ee=P.names.length;q(P.defaultVisible.length,ee,`${n}.optionalContent.defaultVisible`);for(let e=0;e<ee;e+=1)P.defaultVisible[e]>1&&H(V.InvalidNumber,`${n}.optionalContent.defaultVisible[${e}]`,`expected zero or one`);let F=e.markedContent;U(F,`${n}.markedContent`),W(F,[`tags`,`propertyNames`,`mcids`,`parentIndices`],`${n}.markedContent`),(!Array.isArray(F.tags)||F.tags.some(e=>typeof e!=`string`))&&H(V.InvalidShape,`${n}.markedContent.tags`,`expected strings`);let te=F.tags.length;(!Array.isArray(F.propertyNames)||F.propertyNames.some(e=>e!==null&&typeof e!=`string`))&&H(V.InvalidShape,`${n}.markedContent.propertyNames`,`expected strings or null`),q(F.propertyNames.length,te,`${n}.markedContent.propertyNames`),G(F.mcids,Int32Array,`${n}.markedContent.mcids`),G(F.parentIndices,Int32Array,`${n}.markedContent.parentIndices`),q(F.mcids.length,te,`${n}.markedContent.mcids`),q(F.parentIndices.length,te,`${n}.markedContent.parentIndices`);for(let e=0;e<te;e+=1)J(F.parentIndices[e],te,`${n}.markedContent.parentIndices[${e}]`);Rd(F.parentIndices,`${n}.markedContent.parentIndices`);let ne={transforms:i,paths:o,fillPaths:c,strokeSegments:u,strokeStyles:d,glyphs:p,fonts:h,images:_,meshes:y,functions:S,gradients:w,patterns:E,clips:O,colors:j,paints:N,optionalContent:ee,markedContent:te};for(let[e,r]of Object.entries(ne))Id(r,t,`${n}.${e}`);for(let e=0;e<j;e+=1){let t=A.spaceKinds[e];(t>Te.DeviceN||A.componentCounts[e]===0)&&H(V.InvalidNumber,`${n}.colors.spaceKinds[${e}]`,`unknown or zero-component color space`);let r=t===Te.DeviceGray||t===Te.CalGray||t===Te.Indexed||t===Te.Separation?1:t===Te.DeviceRgb||t===Te.CalRgb||t===Te.Lab?3:t===Te.DeviceCmyk?4:0;r!==0&&A.componentCounts[e]!==r&&H(V.InvalidCardinality,`${n}.colors.componentCounts[${e}]`,`color space requires ${r} components`);let i=A.iccModes[e],a=A.iccTransformOffsets[e+1]-A.iccTransformOffsets[e],o=A.componentCounts[e],s=t===Te.IccBased,c=o===1?256:o===3?33:o===4?17:0;if((i>4||!s&&i!==0||s&&c===0||i===4&&o!==3||a!==(i>=2?3*c**o:0))&&H(V.InvalidCardinality,`${n}.colors.iccModes[${e}]`,`ICC mode and transform lattice must match the color space`),s){let t=A.parameterOffsets[e];A.parameterOffsets[e+1]-t!==2*o&&H(V.InvalidCardinality,`${n}.colors.parameters`,`ICC Range must have two bounds per component`);for(let e=0;e<o;e+=1)A.parameters[t+e*2]>A.parameters[t+e*2+1]&&H(V.InvalidNumber,`${n}.colors.parameters`,`ICC Range is reversed`);i===1&&(A.alternateSpaceIndices[e]<0||A.componentCounts[A.alternateSpaceIndices[e]]!==o)&&H(V.InvalidReference,`${n}.colors.alternateSpaceIndices[${e}]`,`ICC fallback requires a compatible alternate color space`)}J(A.alternateSpaceIndices[e],j,`${n}.colors.alternateSpaceIndices[${e}]`),J(A.functionIndices[e],S,`${n}.colors.functionIndices[${e}]`)}Rd(A.alternateSpaceIndices,`${n}.colors.alternateSpaceIndices`);for(let e=0;e<_;e+=1)J(g.colorSpaceIndices[e],j,`${n}.images.colorSpaceIndices[${e}]`),g.imageMask[e]===0?g.colorSpaceIndices[e]<0&&g.formats[e]!==ke.Jpeg2000&&g.formats[e]!==ke.Gray1&&g.formats[e]!==ke.Gray8&&g.formats[e]!==ke.GrayAlpha8&&g.formats[e]!==ke.Rgba8&&g.formats[e]!==ke.Rgba16&&H(V.InvalidReference,`${n}.images.colorSpaceIndices[${e}]`,`encoded image has no self-contained PDF color space`):(g.colorSpaceIndices[e]>=0||g.formats[e]!==ke.Gray8)&&H(V.InvalidReference,`${n}.images[${e}]`,`stencil image must use self-contained Gray8 coverage without a color space`);for(let e=0;e<y;e+=1)jd(v.colorSpaceIndices[e],j,`${n}.meshes.colorSpaceIndices[${e}]`);for(let e=0;e<C.stopPaintIndices.length;e+=1)jd(C.stopPaintIndices[e],N,`${n}.gradients.stopPaintIndices[${e}]`);for(let e=0;e<E;e+=1)J(T.underlyingColorSpaceIndices[e],j,`${n}.patterns.underlyingColorSpaceIndices[${e}]`);for(let e=0;e<w;e+=1){J(C.colorSpaceIndices[e],j,`${n}.gradients.colorSpaceIndices[${e}]`),J(C.functionIndices[e],S,`${n}.gradients.functionIndices[${e}]`),J(C.meshIndices[e],y,`${n}.gradients.meshIndices[${e}]`);let t=C.kinds[e],r=t===Ee.FreeFormMesh||t===Ee.LatticeMesh?Ae.Triangles:t===Ee.CoonsPatchMesh?Ae.CoonsPatch:t===Ee.TensorPatchMesh?Ae.TensorPatch:-1,i=t===Ee.Axial||t===Ee.Radial||t===Ee.Function;r<0&&!i&&H(V.InvalidNumber,`${n}.gradients.kinds[${e}]`,`unknown gradient kind`);let a=C.meshIndices[e];r>=0?(jd(a,y,`${n}.gradients.meshIndices[${e}]`),v.kinds[a]!==r&&H(V.InvalidReference,`${n}.gradients.meshIndices[${e}]`,`gradient and mesh kinds disagree`),v.colorSpaceIndices[a]!==C.colorSpaceIndices[e]&&H(V.InvalidReference,`${n}.gradients.colorSpaceIndices[${e}]`,`gradient and mesh color spaces disagree`)):a>=0&&H(V.InvalidReference,`${n}.gradients.meshIndices[${e}]`,`a non-mesh gradient must not reference a mesh`)}for(let e=0;e<N;e+=1){let t=M.kinds[e],r=t===ye.SolidColor?j:t===ye.Gradient?w:t===ye.Pattern?E:-1;if(r<0&&H(V.InvalidNumber,`${n}.paints.kinds[${e}]`,`unknown paint kind`),jd(M.resourceIndices[e],r,`${n}.paints.resourceIndices[${e}]`),J(M.patternTransformIndices[e],i,`${n}.paints.patternTransformIndices[${e}]`),J(M.patternBasePaintIndices[e],N,`${n}.paints.patternBasePaintIndices[${e}]`),t===ye.Pattern){M.patternTransformIndices[e]<0&&H(V.InvalidReference,`${n}.paints.patternTransformIndices[${e}]`,`pattern paint requires its use-time transform`);let t=T.kinds[M.resourceIndices[e]],r=M.resourceIndices[e],i=M.patternBasePaintIndices[e];t===we.UncoloredTiling?(i<0||i>=e||M.kinds[i]!==ye.SolidColor||M.alphas[i]!==1||M.overprint[i]!==0||M.overprintModes[i]!==0)&&H(V.InvalidReference,`${n}.paints.patternBasePaintIndices[${e}]`,`uncolored tiling pattern requires a preceding opaque solid base-color paint`):i>=0&&H(V.InvalidReference,`${n}.paints.patternBasePaintIndices[${e}]`,`colored or shading pattern must not carry a base-color binding`),t===we.Shading?(T.gradientIndices[r]<0&&H(V.InvalidReference,`${n}.patterns.gradientIndices[${r}]`,`a used shading pattern requires a gradient resource`),T.programIndices[r]>=0&&H(V.InvalidReference,`${n}.patterns.programIndices[${r}]`,`a shading pattern must not reference a tiling-cell program`)):(T.programIndices[r]<0&&H(V.InvalidReference,`${n}.patterns.programIndices[${r}]`,`a used tiling pattern requires a reusable cell program`),T.gradientIndices[r]>=0&&H(V.InvalidReference,`${n}.patterns.gradientIndices[${r}]`,`a tiling pattern must not reference a shading gradient`))}else(M.patternTransformIndices[e]>=0||M.patternBasePaintIndices[e]>=0)&&H(V.InvalidReference,`${n}.paints[${e}]`,`non-pattern paint carries pattern-only metadata`);(M.alphas[e]<0||M.alphas[e]>1)&&H(V.InvalidNumber,`${n}.paints.alphas[${e}]`,`alpha must be in [0, 1]`),M.overprint[e]>1&&H(V.InvalidNumber,`${n}.paints.overprint[${e}]`,`expected 0 or 1`),M.overprintModes[e]>1&&H(V.InvalidNumber,`${n}.paints.overprintModes[${e}]`,`expected PDF overprint mode 0 or 1`)}return ne}function Rd(e,t){let n=new Uint8Array(e.length);for(let r=0;r<e.length;r+=1){if(n[r]!==0)continue;let i=r;for(;i>=0&&n[i]===0;)n[i]=1,i=e[i];for(i>=0&&n[i]===1&&H(V.ResourceCycle,`${t}[${i}]`,`cycle detected`),i=r;i>=0&&n[i]===1;)n[i]=2,i=e[i]}}function zd(e,t,n){jd(e.transformIndex,t.transforms,`${n}.transformIndex`),J(e.clipIndex,t.clips,`${n}.clipIndex`),J(e.optionalContentIndex,t.optionalContent,`${n}.optionalContentIndex`),J(e.markedContentIndex,t.markedContent,`${n}.markedContentIndex`),(!Number.isSafeInteger(e.sourceOffset)||e.sourceOffset<-1)&&H(V.InvalidNumber,`${n}.sourceOffset`,`expected -1 or a safe integer`),(!Number.isSafeInteger(e.sourceLength)||e.sourceLength<-1)&&H(V.InvalidNumber,`${n}.sourceLength`,`expected -1 or a safe integer`)}function Bd(e,t,n,r,i,a,o,s=!1){U(e,o);let c=[`kind`,`transformIndex`,`clipIndex`,`optionalContentIndex`,`markedContentIndex`,`sourceOffset`,`sourceLength`];if(e.kind===`invoke-group`)W(e,[...c,`groupIndex`],o);else if(e.kind===`invoke-program`)W(e,[...c,`programIndex`,`type3PaintIndex`,`viewTransformFlags`],o);else if(e.kind===`draw`){let t=[...c,`source`,`first`,`count`];e.source===`paths`?Ed(e,[...t,`fillPaintIndex`,`strokePaintIndex`,`strokeStyleIndex`,`fillRule`],[`fillPaintInherited`,`strokePaintInherited`],o):e.source===`fill-paths`||e.source===`stroke-segments`?W(e,[...t,`paintIndex`],o):e.source===`glyphs`?Ed(e,[...t,`fillPaintIndex`,`strokePaintIndex`,`strokeStyleIndex`,`renderingMode`],[`strokeTransformIndex`],o):e.source===`images`?W(e,[...t,`paintIndex`],o):(e.source===`meshes`||e.source===`gradients`||e.source===`patterns`)&&W(e,t,o)}else H(V.InvalidShape,`${o}.kind`,`unknown command kind`);if(zd(e,t,o),e.kind===`invoke-group`){jd(e.groupIndex,i,`${o}.groupIndex`);return}if(e.kind===`invoke-program`){jd(e.programIndex,a,`${o}.programIndex`),J(e.type3PaintIndex,t.paints,`${o}.type3PaintIndex`),(!Number.isSafeInteger(e.viewTransformFlags)||e.viewTransformFlags<0||(e.viewTransformFlags&~(xe.NoZoom|xe.NoRotate))!==0)&&H(V.InvalidNumber,`${o}.viewTransformFlags`,`unknown view-transform flag`);return}let l=e.source===`paths`?t.paths:e.source===`fill-paths`?t.fillPaths:e.source===`stroke-segments`?t.strokeSegments:e.source===`glyphs`?t.glyphs:e.source===`images`?t.images:e.source===`meshes`?t.meshes:e.source===`gradients`?t.gradients:e.source===`patterns`?t.patterns:-1;if(l<0&&H(V.InvalidShape,`${o}.source`,`unknown draw source`),Md(e.first,e.count,l,o),e.source===`fill-paths`||e.source===`stroke-segments`)J(e.paintIndex,t.paints,`${o}.paintIndex`),e.paintIndex<0&&!s&&H(V.InvalidReference,`${o}.paintIndex`,`inherited paint requires an uncolored reusable program`);else if(e.source===`paths`){J(e.fillPaintIndex,t.paints,`${o}.fillPaintIndex`),J(e.strokePaintIndex,t.paints,`${o}.strokePaintIndex`),J(e.strokeStyleIndex,t.strokeStyles,`${o}.strokeStyleIndex`),(e.fillPaintInherited!==void 0&&typeof e.fillPaintInherited!=`boolean`||e.strokePaintInherited!==void 0&&typeof e.strokePaintInherited!=`boolean`)&&H(V.InvalidShape,o,`path inheritance flags must be boolean`);let n=e.fillPaintInherited===!0,r=e.strokePaintInherited===!0;(n||r)&&!s&&H(V.InvalidReference,o,`inherited path paint requires an uncolored reusable program`),(n&&e.fillPaintIndex>=0||r&&e.strokePaintIndex>=0)&&H(V.InvalidReference,o,`path paint cannot be both explicit and inherited`);let i=e.fillPaintIndex>=0||n,a=e.strokePaintIndex>=0||r;!i&&!a&&H(V.InvalidReference,o,`path run has no paint`),a&&e.strokeStyleIndex<0&&H(V.InvalidReference,`${o}.strokeStyleIndex`,`painted stroke needs a style`),!a&&e.strokeStyleIndex>=0&&H(V.InvalidReference,`${o}.strokeStyleIndex`,`fill-only path must not carry a stroke style`),e.fillRule!==0&&e.fillRule!==1&&H(V.InvalidNumber,`${o}.fillRule`,`unknown fill rule`)}else if(e.source===`glyphs`){J(e.fillPaintIndex,t.paints,`${o}.fillPaintIndex`),J(e.strokePaintIndex,t.paints,`${o}.strokePaintIndex`),J(e.strokeStyleIndex,t.strokeStyles,`${o}.strokeStyleIndex`),e.strokeTransformIndex!==void 0&&jd(e.strokeTransformIndex,t.transforms,`${o}.strokeTransformIndex`),(!Number.isInteger(e.renderingMode)||e.renderingMode<0||e.renderingMode>7)&&H(V.InvalidNumber,`${o}.renderingMode`,`expected PDF text mode 0..7`);let n=e.renderingMode===0||e.renderingMode===2||e.renderingMode===4||e.renderingMode===6,i=e.renderingMode===1||e.renderingMode===2||e.renderingMode===5||e.renderingMode===6;!i&&e.strokeTransformIndex!==void 0&&H(V.InvalidReference,`${o}.strokeTransformIndex`,`fill-only glyphs must not carry a stroke transform`);let a=e.fillPaintIndex>=0||s&&n,c=e.strokePaintIndex>=0||s&&i;a!==n&&H(V.InvalidReference,`${o}.fillPaintIndex`,`fill paint does not match the PDF text rendering mode`),c!==i&&H(V.InvalidReference,`${o}.strokePaintIndex`,`stroke paint does not match the PDF text rendering mode`),e.strokeStyleIndex>=0!==i&&H(V.InvalidReference,`${o}.strokeStyleIndex`,`stroke style does not match the PDF text rendering mode`);let l=e.renderingMode===3||e.renderingMode===7,u=e.renderingMode>=4;for(let t=e.first;t<e.first+e.count;t+=1){let e=r[t];(e&L.Type3)!==0&&(e&L.Invisible)===0&&H(V.InvalidReference,`${o}.first`,`visible Type3 glyph paint must use its reusable CharProc program`),(e&L.Invisible)!==0!==l&&H(V.InvalidReference,`${o}.renderingMode`,`glyph invisibility flag does not match the PDF text rendering mode`),(e&L.ClipOnly)!==0!==u&&H(V.InvalidReference,`${o}.renderingMode`,`glyph clipping flag does not match the PDF text rendering mode`)}}else if(e.source===`images`){J(e.paintIndex,t.paints,`${o}.paintIndex`);for(let t=e.first;t<e.first+e.count;t+=1){let r=n[t]!==0;r&&e.paintIndex<0&&!s&&H(V.InvalidReference,`${o}.paintIndex`,`stencil image mask requires the current nonstroking paint`),!r&&e.paintIndex>=0&&H(V.InvalidReference,`${o}.paintIndex`,`ordinary image must not carry a stencil paint`)}}}function Vd(e,t,n,r){let i=e.displayProgram;U(i,r),W(i,[`rootGroupIndex`,`groups`,`programs`],r),(!Array.isArray(i.groups)||!Array.isArray(i.programs))&&H(V.InvalidShape,r,`groups and programs must be arrays`),jd(i.rootGroupIndex,i.groups.length,`${r}.rootGroupIndex`);let a=new Set;for(let t=0;t<e.stores.patterns.kinds.length;t+=1){if(e.stores.patterns.kinds[t]!==we.UncoloredTiling)continue;let n=e.stores.patterns.programIndices[t];n>=0&&n<i.programs.length&&a.add(n)}let{groupModes:o,programModes:s}=Hd(e,a),c=0;i.groups.forEach((n,a)=>{let s=`${r}.groups[${a}]`;U(n,s),W(n,[`commands`,`isolated`,`knockout`,`blendMode`,`alpha`,`alphaIsShape`,`softMaskGroupIndex`,`softMaskSubtype`,`softMaskTransferFunctionIndex`,`backdropPaintIndex`,`blendingColorSpaceIndex`,`clipIndex`],s);let l=n;Array.isArray(l.commands)||H(V.InvalidShape,`${s}.commands`,`expected an array`),c+=l.commands.length,l.commands.forEach((n,r)=>Bd(n,t,e.stores.images.imageMask,e.stores.glyphs.flags,i.groups.length,i.programs.length,`${s}.commands[${r}]`,o[a]===2)),(typeof l.isolated!=`boolean`||typeof l.knockout!=`boolean`||typeof l.alphaIsShape!=`boolean`)&&H(V.InvalidShape,s,`group flags must be boolean`),Od(l.alpha,`${s}.alpha`),(l.alpha<0||l.alpha>1)&&H(V.InvalidNumber,`${s}.alpha`,`expected [0, 1]`),Ud(l.blendMode)||H(V.InvalidShape,`${s}.blendMode`,`unknown PDF blend mode`),J(l.softMaskGroupIndex,i.groups.length,`${s}.softMaskGroupIndex`),l.softMaskSubtype!==null&&l.softMaskSubtype!==`Alpha`&&l.softMaskSubtype!==`Luminosity`&&H(V.InvalidShape,`${s}.softMaskSubtype`,`expected Alpha, Luminosity, or null`),J(l.softMaskTransferFunctionIndex,t.functions,`${s}.softMaskTransferFunctionIndex`),l.softMaskGroupIndex<0&&(l.softMaskSubtype!==null||l.softMaskTransferFunctionIndex>=0)&&H(V.InvalidReference,s,`soft-mask metadata requires a soft-mask group`),l.softMaskGroupIndex>=0&&l.softMaskSubtype===null&&H(V.InvalidReference,`${s}.softMaskSubtype`,`a referenced soft-mask group requires Alpha or Luminosity semantics`),J(l.backdropPaintIndex,t.paints,`${s}.backdropPaintIndex`),J(l.blendingColorSpaceIndex,t.colors,`${s}.blendingColorSpaceIndex`),J(l.clipIndex,t.clips,`${s}.clipIndex`)}),i.programs.forEach((n,a)=>{let o=`${r}.programs[${a}]`;U(n,o),W(n,[`kind`,`commands`,`matrixIndex`,`bounds`,`clipToBounds`,`resourceName`],o);let l=n;l.kind!==`form`&&l.kind!==`type3`&&l.kind!==`pattern`&&H(V.InvalidShape,`${o}.kind`,`expected form, type3, or pattern`),Array.isArray(l.commands)||H(V.InvalidShape,`${o}.commands`,`expected an array`),c+=l.commands.length,l.commands.forEach((n,r)=>{let c=`${o}.commands[${r}]`;Bd(n,t,e.stores.images.imageMask,e.stores.glyphs.flags,i.groups.length,i.programs.length,c,s[a]===2),n.kind===`invoke-program`&&n.type3PaintIndex>=0&&i.programs[n.programIndex]?.kind!==`type3`&&H(V.InvalidReference,`${c}.type3PaintIndex`,`inherited Type3 paint requires a Type3 target program`)}),jd(l.matrixIndex,t.transforms,`${o}.matrixIndex`),l.bounds!==null&&Nd(l.bounds,`${o}.bounds`),typeof l.clipToBounds!=`boolean`&&H(V.InvalidShape,`${o}.clipToBounds`,`expected boolean`),l.resourceName!==null&&typeof l.resourceName!=`string`&&H(V.InvalidShape,`${o}.resourceName`,`expected string or null`)}),i.groups.forEach((e,t)=>{e.commands.forEach((e,n)=>{e.kind===`invoke-program`&&e.type3PaintIndex>=0&&i.programs[e.programIndex]?.kind!==`type3`&&H(V.InvalidReference,`${r}.groups[${t}].commands[${n}].type3PaintIndex`,`inherited Type3 paint requires a Type3 target program`)})}),c>n.maxCommandsPerPage&&H(V.ResourceLimit,r,`${c} commands exceed limit ${n.maxCommandsPerPage}`);for(let t=0;t<e.stores.fonts.type3ProgramIndices.length;t+=1){let n=e.stores.fonts.type3ProgramIndices[t];J(n,i.programs.length,`stores.fonts.type3ProgramIndices[${t}]`),n>=0&&i.programs[n].kind!==`type3`&&H(V.InvalidReference,`stores.fonts.type3ProgramIndices[${t}]`,`Type3 glyph must reference a Type3 reusable program`)}for(let n=0;n<e.stores.patterns.programIndices.length;n+=1){J(e.stores.patterns.programIndices[n],i.programs.length,`stores.patterns.programIndices[${n}]`);let r=e.stores.patterns.programIndices[n];r>=0&&i.programs[r].kind!==`pattern`&&H(V.InvalidReference,`stores.patterns.programIndices[${n}]`,`tiling pattern must reference a Pattern reusable program`),J(e.stores.patterns.gradientIndices[n],t.gradients,`stores.patterns.gradientIndices[${n}]`)}Wd(e,r)}function Hd(e,t){let{groups:n,programs:r,rootGroupIndex:i}=e.displayProgram,a=new Uint8Array(n.length),o=new Uint8Array(r.length),s=[],c=(e,t,n)=>{let r=e===`group`?a:o;!Number.isSafeInteger(t)||t<0||t>=r.length||(r[t]&n)===0&&(r[t]|=n,s.push({kind:e,index:t,mode:n}))};c(`group`,i,1);for(let e=0;e<r.length;e+=1)Td(r[e])&&(r[e].kind===`type3`||t.has(e)?c(`program`,e,2):r[e].kind===`pattern`&&c(`program`,e,1));for(let e=0;e<s.length;e+=1){let{kind:t,index:i,mode:a}=s[e],o=t===`group`?n[i]:r[i];if(Td(o)&&Array.isArray(o.commands)){t===`group`&&typeof o.softMaskGroupIndex==`number`&&o.softMaskGroupIndex>=0&&c(`group`,o.softMaskGroupIndex,a);for(let e of o.commands)Td(e)&&(e.kind===`invoke-group`?c(`group`,e.groupIndex,a):e.kind===`invoke-program`&&c(`program`,e.programIndex,typeof e.type3PaintIndex==`number`&&e.type3PaintIndex>=0?2:a))}}return{groupModes:a,programModes:o}}function Ud(e){return e===`Normal`||e===`Multiply`||e===`Screen`||e===`Overlay`||e===`Darken`||e===`Lighten`||e===`ColorDodge`||e===`ColorBurn`||e===`HardLight`||e===`SoftLight`||e===`Difference`||e===`Exclusion`||e===`Hue`||e===`Saturation`||e===`Color`||e===`Luminosity`}function Wd(e,t){let{groups:n,programs:r}=e.displayProgram,i=n.length,a=i+r.length,o=new Uint8Array(a),s=t=>{if(t.kind!==`draw`)return[];let n=t.source===`paths`?[t.fillPaintIndex,t.strokePaintIndex]:t.source===`fill-paths`||t.source===`stroke-segments`||t.source===`images`?[t.paintIndex]:t.source===`glyphs`?[t.fillPaintIndex,t.strokePaintIndex]:[],r=[];for(let t of n){if(t<0||e.stores.paints.kinds[t]!==ye.Pattern)continue;let n=e.stores.paints.resourceIndices[t],i=e.stores.patterns.programIndices[n];i>=0&&r.push(i)}return r},c=t=>{let a=[],o=t<i?n[t].commands:r[t-i].commands;if(t<i){let e=n[t].softMaskGroupIndex;e>=0&&a.push(e)}for(let t of o){t.kind===`invoke-group`&&a.push(t.groupIndex),t.kind===`invoke-program`&&a.push(i+t.programIndex);for(let e of s(t))a.push(i+e);if(t.kind===`draw`&&t.source===`patterns`)for(let n=t.first;n<t.first+t.count;n+=1){let t=e.stores.patterns.programIndices[n];t>=0&&a.push(i+t)}}return a},l=[];for(let e=0;e<a;e+=1)if(o[e]===0)for(o[e]=1,l.push({node:e,edges:c(e),cursor:0});l.length>0;){let e=l[l.length-1];if(e.cursor>=e.edges.length){o[e.node]=2,l.pop();continue}let n=e.edges[e.cursor++];o[n]===1&&H(V.ResourceCycle,t,`display node ${n} is cyclic`),o[n]===0&&(o[n]=1,l.push({node:n,edges:c(n),cursor:0}))}}function Gd(e,t,n){let r=e.textIndex;U(r,n),W(r,[`version`,`text`,`charGlyphIndices`,`fallbackQuads`],n),r.version!==1&&H(V.IncompatibleVersion,`${n}.version`,`expected 1`),typeof r.text!=`string`&&H(V.InvalidShape,`${n}.text`,`expected a string`),r.text.length>t.maxTextCodeUnitsPerPage&&H(V.ResourceLimit,`${n}.text`,`text limit exceeded`),G(r.charGlyphIndices,Int32Array,`${n}.charGlyphIndices`),G(r.fallbackQuads,Float32Array,`${n}.fallbackQuads`),q(r.charGlyphIndices.length,r.text.length,`${n}.charGlyphIndices`),kd(r.fallbackQuads.length,4,`${n}.fallbackQuads`),K(r.fallbackQuads,`${n}.fallbackQuads`);let i=r.fallbackQuads.length/4,a=e.stores.glyphs.glyphIds.length;for(let e=0;e<r.charGlyphIndices.length;e+=1){let t=r.charGlyphIndices[e];(t>=a||t<=-2&&-t-2>=i)&&H(V.InvalidReference,`${n}.charGlyphIndices[${e}]`,`text geometry reference is out of range`)}}function Kd(e){let t={...wd,...e};for(let[e,n]of Object.entries(t))if(!Number.isSafeInteger(n)||n<=0)throw RangeError(`${e} must be a positive safe integer`);return t}function qd(e,t=new Set){return typeof e!=`object`||!e||t.has(e)?0:(t.add(e),ArrayBuffer.isView(e)?e.byteLength:Array.isArray(e)?e.reduce((e,n)=>e+qd(n,t),0):Object.values(e).reduce((e,n)=>e+qd(n,t),0))}function Jd(e,n){let r=Kd(n);U(e,`page`),Ed(e,[`kind`,`version`,`pageInfo`,`displayProgram`,`stores`,`textIndex`,`diagnostics`],[`annotations`],`page`);let i=e;i.kind!==`hepr-page`&&H(V.InvalidShape,`page.kind`,`expected hepr-page`),i.version!==8&&H(V.IncompatibleVersion,`page.version`,`expected 8; v7 and older data must be regenerated`),Pd(i.pageInfo,`page.pageInfo`);let a=qd(i.stores);if(a>r.maxTypedArrayBytesPerPage&&H(V.ResourceLimit,`page.stores`,`${a} typed-array bytes exceed limit ${r.maxTypedArrayBytesPerPage}`),Vd(i,Ld(i.stores,r,`page.stores`),r,`page.displayProgram`),Gd(i,r,`page.textIndex`),Fd(i.diagnostics,`page.diagnostics`),i.annotations!==void 0)try{t(i.annotations,{sourcePageIndex:i.pageInfo.sourcePageIndex,conditionCount:i.stores.optionalContent.defaultVisible.length})}catch{H(V.InvalidShape,`page.annotations`,`invalid annotation metadata`)}}function Yd(e){if(e.retainedPages===void 0)return;if(!Array.isArray(e.retainedPages))throw TypeError(`Invalid retained page resources.`);let t=new Set;for(let n of e.retainedPages){if(!n||!(n.matrix instanceof Float32Array)||n.matrix.length!==6||!n.matrix.every(Number.isFinite)||Math.abs(n.matrix[0]*n.matrix[3]-n.matrix[1]*n.matrix[2])<=1e-12||!(n.optionalContentConditions instanceof Int32Array))throw TypeError(`Invalid retained page placement or conditions.`);if(t.has(n.page)||(Jd(n.page),t.add(n.page)),n.optionalContentConditions.length!==n.page.stores.optionalContent.names.length||n.optionalContentConditions.some(t=>t<-1||t>=(e.optionalContent?.conditions.length??0)))throw TypeError(`Retained page references an invalid optional-content condition.`)}}var Xd=16,Zd=4294967295,Qd=e=>Math.ceil(e/4)*4,$d=new Uint8Array(new Uint32Array([1]).buffer)[0]===1,ef={u8:Uint8Array,u32:Uint32Array,i32:Int32Array,f32:Float32Array};function tf(e){throw TypeError(`Invalid retained page encoding: ${e}.`)}function nf(e,t){t?.throwIfAborted(),Jd(e);let n=[],r=new Map,i=new Set,a=0,o=e=>{if(t?.throwIfAborted(),e===null||typeof e==`string`||typeof e==`boolean`)return e;if(typeof e==`number`)return Number.isFinite(e)||tf(`non-finite metadata`),e;if(e instanceof Uint8Array||e instanceof Uint32Array||e instanceof Int32Array||e instanceof Float32Array){let t=r.get(e);if(t)return t;let i=e instanceof Uint8Array?`u8`:e instanceof Uint32Array?`u32`:e instanceof Int32Array?`i32`:`f32`,o={$heprArray:i,offset:a,length:e.length};return n.push({array:e,kind:i,offset:a}),r.set(e,o),a=Qd(a+e.byteLength),a>Zd&&tf(`resource length exceeds its uint32 field`),o}(typeof e!=`object`||ArrayBuffer.isView(e)||e instanceof ArrayBuffer)&&tf(`unsupported metadata value`),i.has(e)&&tf(`cyclic metadata`),i.add(e);let s;if(Array.isArray(e))s=e.map(e=>o(e));else{let t=Object.create(null);for(let[n,r]of Object.entries(e))n===`$heprArray`&&tf(`reserved metadata key`),r!==void 0&&(t[n]=o(r));s=t}return i.delete(e),s},s=new TextEncoder().encode(JSON.stringify(o(e)));s.length>Zd&&tf(`metadata length exceeds its uint32 field`);let c=Qd(Xd+s.length),l=new Uint8Array(c+a),u=new DataView(l.buffer);l.set([72,82,80,0]),u.setUint32(4,1,!0),u.setUint32(8,s.length,!0),u.setUint32(12,a,!0),l.set(s,Xd);for(let{array:e,kind:r,offset:i}of n)if(t?.throwIfAborted(),$d||r===`u8`)l.set(new Uint8Array(e.buffer,e.byteOffset,e.byteLength),c+i);else for(let t=0;t<e.length;t++){let n=c+i+t*4;r===`f32`?u.setFloat32(n,e[t],!0):r===`i32`?u.setInt32(n,e[t],!0):u.setUint32(n,e[t],!0)}return t?.throwIfAborted(),l}function rf(e,t){t?.throwIfAborted(),(!(e instanceof Uint8Array)||e.length<Xd)&&tf(`invalid resource length`),e.buffer instanceof ArrayBuffer||(e=new Uint8Array(e));let n=new DataView(e.buffer,e.byteOffset,e.byteLength);(e[0]!==72||e[1]!==82||e[2]!==80||e[3]!==0||n.getUint32(4,!0)!==1)&&tf(`unsupported resource format`);let r=n.getUint32(8,!0),i=n.getUint32(12,!0),a=Qd(Xd+r);a+i!==e.length&&tf(`inconsistent resource sections`);let o=JSON.parse(new TextDecoder(`utf-8`,{fatal:!0}).decode(e.subarray(Xd,Xd+r)));for(let t=Xd+r;t<a;t++)e[t]&&tf(`nonzero metadata padding`);let s=new Map,c=r=>{if(t?.throwIfAborted(),r===null||typeof r==`string`||typeof r==`boolean`)return r;if(typeof r==`number`)return Number.isFinite(r)||tf(`non-finite metadata`),r;if(typeof r!=`object`&&tf(`invalid metadata value`),Array.isArray(r))return r.map(e=>c(e));let o=r;if(Object.hasOwn(o,`$heprArray`)){let t=o.$heprArray,r=o.offset,c=o.length;(Object.keys(o).length!==3||typeof t!=`string`||!Object.hasOwn(ef,t)||typeof r!=`number`||!Number.isSafeInteger(r)||r<0||r%4||typeof c!=`number`||!Number.isSafeInteger(c)||c<0)&&tf(`invalid array reference`);let l=ef[t],u=l.BYTES_PER_ELEMENT;c*u>i-r&&tf(`array exceeds resource section`);let d=`${t}:${r}:${c}`,f=s.get(d);if(f)return f;let p,m=e.byteOffset+a+r;if(($d||u===1)&&m%u===0)p=new l(e.buffer,m,c);else{p=new l(c);for(let e=0;e<c;e++){let i=a+r+e*u;p[e]=t===`u8`?n.getUint8(i):t===`f32`?n.getFloat32(i,!0):t===`i32`?n.getInt32(i,!0):n.getUint32(i,!0)}}return s.set(d,p),p}let l={};for(let[e,t]of Object.entries(o))Object.defineProperty(l,e,{value:c(t),enumerable:!0,writable:!0,configurable:!0});return l},l=c(o);return Jd(l),t?.throwIfAborted(),l}var af=`geometry/clip-paths.d512`,of=`geometry/draw-runs.varint`,sf=`geometry/paint-graph.varint`,cf=4294967295,lf=[`fill`,`stroke`,`text`,`raster`,`gradient-fill`,`gradient-stroke`],uf=0,df=1,ff=2;function Y(e,t){throw Error(`Invalid HEP ${e} section: ${t}.`)}function pf(e,t,n,r){return(typeof e!=`number`||!Number.isSafeInteger(e)||e<0||e>t)&&Y(n,`${r} is out of range`),e}function mf(e){pf(e.length,cf,`clip path`,`path count`);let t=new ts(e.length*8+64);t.writeVarUint32(e.length);let n=0;for(let r of e){r.edges.length%4!=0&&Y(`clip path`,`an edge list is not a whole number of edges`);let e=pf(r.edges.length/4,cf,`clip path`,`edge count`);n=pf(n+e,cf,`clip path`,`column length`),t.writeZigzagVarint(r.parent),t.writeByte(r.fillRule),t.writeVarUint32(e)}let r=new Float32Array(n*4),i=0;for(let t of e)r.set(t.edges,i),i+=t.edges.length;let a=[0,1,2,3].map(e=>rs(r,n,4,e));for(let e of a)t.writeVarUint32(pf(e.length,cf,`clip path`,`column length`));for(let e of a)t.writeBytes(e);return t.toUint8Array()}function hf(e){let t=new ns(e),n=t.readVarUint32();n*3+4>e.length-t.byteOffset&&Y(`clip path`,`path records are truncated`);let r=new Int32Array(n),i=new Uint8Array(n),a=new Uint32Array(n),o=0;for(let e=0;e<n;e+=1){r[e]=t.readZigzagVarint();let n=t.readByte(`clip fill rule`);n>1&&Y(`clip path`,`fill rule must be zero or one`),i[e]=n,a[e]=t.readVarUint32(),o=pf(o+a[e],cf,`clip path`,`column length`),(r[e]<-1||r[e]>=e)&&Y(`clip path`,`parent must reference an earlier path`)}let s=[0,1,2,3].map(()=>t.readVarUint32()),c=t.byteOffset;c+s.reduce((e,t)=>e+t,0)!==e.length&&Y(`clip path`,`column lengths do not fill the section`),s.some(e=>e<o)&&Y(`clip path`,`coordinate columns are truncated`);let l=new Float32Array(o*4),u=c;for(let t=0;t<4;t+=1)is(e,u,u+s[t],l,o,4,t),u+=s[t];let d=[],f=0;for(let e=0;e<n;e+=1){let t=a[e]*4;d.push({parent:r[e],fillRule:i[e],edges:l.slice(f,f+t)}),f+=t}return d}function gf(e){pf(e.length,cf,`draw run`,`run count`);let t=new ts(e.length*4+16);t.writeVarUint32(e.length);let n=new Float64Array(lf.length),r=0;for(let i of e){let e=lf.indexOf(i.kind);e<0&&Y(`draw run`,`unknown kind ${String(i.kind)}`);let a=i.clipIndex!==void 0,o=i.optionalContent!==void 0;t.writeByte(e|(a?8:0)|(o?16:0)|(i.blendMode===`Multiply`?32:0)),t.writeZigzagVarint(i.first-n[e]),n[e]=i.first,t.writeVarUint32(i.count),a&&(t.writeZigzagVarint(i.clipIndex-r),r=i.clipIndex),o&&t.writeVarUint32(i.optionalContent)}return t.toUint8Array()}function _f(e,t=!1){if(t)return yf(e);let n=new ns(e),r=n.readVarUint32();r*3>e.length-n.byteOffset&&Y(`draw run`,`run records are truncated`);let i=new Float64Array(lf.length),a=0,o=[];for(let e=0;e<r;e+=1){let e=n.readByte(`draw run flags`);e&192&&Y(`draw run`,`unsupported flag bits`);let t=lf[e&7];t||Y(`draw run`,`unknown kind`);let r=i[e&7]+n.readZigzagVarint();pf(r,cf,`draw run`,`first`),i[e&7]=r;let s={kind:t,first:r,count:n.readVarUint32()};e&8&&(a+=n.readZigzagVarint(),a<0&&Y(`draw run`,`clip index is negative`),s.clipIndex=a),e&16&&(s.optionalContent=n.readVarUint32()),e&32&&(s.blendMode=`Multiply`),o.push(s)}return n.expectEnd(of),o}function vf(e){let t=gf(e),n=[];for(let t=0;t<e.length;){let r=e[t],i=t+1;for(;i<e.length;){let t=e[i],n=e[i-1];if(t.kind!==r.kind||t.clipIndex!==r.clipIndex||t.optionalContent!==r.optionalContent||t.blendMode!==r.blendMode||t.first!==n.first+n.count)break;i++}n.push({first:t,count:i-t}),t=i}let r=new ts(e.length+n.length*4+16);r.writeVarUint32(e.length),r.writeVarUint32(n.length);let i=new Float64Array(lf.length),a=0;for(let t of n){let n=e[t.first],o=lf.indexOf(n.kind),s=n.clipIndex!==void 0,c=n.optionalContent!==void 0,l=n.first===i[o];r.writeByte(o|(s?8:0)|(c?16:0)|(n.blendMode===`Multiply`?32:0)|(l?64:0)),r.writeVarUint32(t.count),l||r.writeVarUint32(pf(n.first,cf,`draw run`,`first`)),s&&(r.writeZigzagVarint(n.clipIndex-a),a=n.clipIndex),c&&r.writeVarUint32(n.optionalContent);for(let n=t.first;n<t.first+t.count;n++)r.writeVarUint32(pf(e[n].count,cf,`draw run`,`count`));let u=e[t.first+t.count-1];i[o]=u.first+u.count}let o=r.toUint8Array();return o.length<t.length?{bytes:o,groupedRuns:!0}:{bytes:t,groupedRuns:!1}}function yf(e){let t=new ns(e),n=t.readVarUint32(),r=t.readVarUint32();(r>n||n+r*2>e.length-t.byteOffset)&&Y(`draw run`,`grouped run records are truncated`);let i=new Float64Array(lf.length),a=0,o=[];for(let s=0;s<r;s++){let r=t.readByte(`grouped draw run flags`),s=lf[r&7];r&128&&Y(`draw run`,`unsupported grouped flag bits`),s||Y(`draw run`,`unknown kind`);let c=t.readVarUint32();(c===0||c>n-o.length)&&Y(`draw run`,`invalid group length`);let l=r&64?i[r&7]:t.readVarUint32(),u;r&8&&(a+=t.readZigzagVarint(),u=pf(a,cf,`draw run`,`clip index`));let d=r&16?t.readVarUint32():void 0;c>e.length-t.byteOffset&&Y(`draw run`,`group counts are truncated`);for(let e=0;e<c;e++){pf(l,cf,`draw run`,`first`);let e={kind:s,first:l,count:t.readVarUint32()};u!==void 0&&(e.clipIndex=u),d!==void 0&&(e.optionalContent=d),r&32&&(e.blendMode=`Multiply`),o.push(e),l+=e.count,l>4294967296&&Y(`draw run`,`range end is out of range`)}i[r&7]=l}return o.length!==n&&Y(`draw run`,`group counts do not match run count`),t.expectEnd(of),o}function bf(e,t){return pf(t,cf,`paint graph`,`source draw run count`),Sf(e,t)}function xf(e,t){return!Object.is(e.alpha,t.alpha)||e.isolated!==t.isolated||e.knockout!==t.knockout||e.blendMode!==t.blendMode||e.optionalContent!==t.optionalContent||e.alphaIsShape!==t.alphaIsShape||!!e.bounds!=!!t.bounds?!1:!e.bounds||!!t.bounds&&Object.is(e.bounds.minX,t.bounds.minX)&&Object.is(e.bounds.minY,t.bounds.minY)&&Object.is(e.bounds.maxX,t.bounds.maxX)&&Object.is(e.bounds.maxY,t.bounds.maxY)}function Sf(e,t){let n=new ts(4096),r=new Set,i=0,a=0,o=!1,s=e=>{n.writeFloat64(e.minX),n.writeFloat64(e.minY),n.writeFloat64(e.maxX),n.writeFloat64(e.maxY)},c=e=>{let t=e.transfer;if(t&&pf(t.length,cf,`paint graph`,`mask transfer length`),n.writeByte(e.subtype===`Luminosity`|(t?2:0)|(e.backdrop?4:0)),t){n.writeVarUint32(t.length);for(let e of t)n.writeFloat32(e)}if(e.backdrop)for(let t of e.backdrop)n.writeFloat64(t);d(e.children)},l=e=>{let t=e.optionalContent!==void 0,r=ae.indexOf(e.blendMode);r<0&&Y(`paint graph`,`unknown blend mode ${String(e.blendMode)}`),n.writeByte(df|(t?4:0)|(e.isolated?8:0)|(e.knockout?16:0)|(e.bounds?32:0)|(e.softMask?64:0)|(e.alphaIsShape===void 0?0:128)),n.writeByte(r),n.writeFloat64(e.alpha),e.alphaIsShape!==void 0&&n.writeByte(+!!e.alphaIsShape),t&&n.writeVarUint32(e.optionalContent),e.bounds&&s(e.bounds),e.softMask&&c(e.softMask)},u=(e,n)=>{if(t===void 0||t-a<2)return 1;let r=e[n];if(r.kind!==`group`||r.softMask||r.children.length!==1||r.children[0].kind!==`draw`)return 1;let i=r.children[0];if(!Number.isSafeInteger(i.runIndex)||i.runIndex<0||i.runIndex>=t)return 1;let o=1,s=Math.min(t-a,t-i.runIndex);for(;o<s&&n+o<e.length;){let t=e[n+o];if(t.kind!==`group`||t.softMask||t.children.length!==1||t.children[0].kind!==`draw`||!xf(r,t)||t.children[0].optionalContent!==i.optionalContent||t.children[0].runIndex!==i.runIndex+o)break;o+=1}return o},d=e=>{r.has(e)&&Y(`paint graph`,`cyclic node lists`),r.add(e),n.writeVarUint32(pf(e.length,cf,`paint graph`,`node count`));for(let t=0;t<e.length;t+=1){let r=e[t],s=u(e,t);if(s>=2&&r.kind===`group`&&r.children[0].kind===`draw`){n.writeByte(3),n.writeVarUint32(s),l(r);let e=r.children[0];n.writeByte(uf|(e.optionalContent===void 0?0:4)),n.writeZigzagVarint(e.runIndex-i),e.optionalContent!==void 0&&n.writeVarUint32(e.optionalContent),i=e.runIndex+s-1,a+=s,o=!0,t+=s-1;continue}let c=r.optionalContent!==void 0;r.kind===`draw`?(n.writeByte(uf|(c?4:0)),n.writeZigzagVarint(r.runIndex-i),i=r.runIndex,c&&n.writeVarUint32(r.optionalContent)):r.kind===`retained`?(n.writeByte(ff|(c?4:0)),n.writeVarUint32(r.retainedPage),n.writeVarUint32(r.firstCommand),n.writeVarUint32(r.count),n.writeVarUint32(r.rasterIndex),c&&n.writeVarUint32(r.optionalContent)):(l(r),d(r.children))}r.delete(e)};return d(e.roots),{bytes:n.toUint8Array(),repeatedGroups:o}}function Cf(e,t){t!==void 0&&pf(t,cf,`paint graph`,`source draw run count`);let n=new ns(e),r=0,i=0,a=()=>({minX:n.readFloat64(`paint bounds`),minY:n.readFloat64(`paint bounds`),maxX:n.readFloat64(`paint bounds`),maxY:n.readFloat64(`paint bounds`)}),o=()=>{let t=n.readByte(`mask flags`);t&248&&Y(`paint graph`,`unsupported mask flag bits`);let r={children:[],subtype:t&1?`Luminosity`:`Alpha`};if(t&2){let t=n.readVarUint32();t*4>e.length-n.byteOffset&&Y(`paint graph`,`mask transfer is truncated`);let i=new Float32Array(t);for(let e=0;e<t;e+=1)i[e]=n.readFloat32(`mask transfer`);r.transfer=i}return t&4&&(r.backdrop=[n.readFloat64(`mask backdrop`),n.readFloat64(`mask backdrop`),n.readFloat64(`mask backdrop`)]),r.children=c(),r},s=e=>{let t=ae[n.readByte(`blend mode`)];t||Y(`paint graph`,`unknown blend mode`);let r={kind:`group`,children:[],alpha:n.readFloat64(`group alpha`),isolated:!!(e&8),knockout:!!(e&16),blendMode:t};return e&128&&(r.alphaIsShape=n.readByte(`alpha is shape`)!==0),e&4&&(r.optionalContent=n.readVarUint32()),e&32&&(r.bounds=a()),e&64&&(r.softMask=o()),r},c=()=>{let a=n.readVarUint32();(t===void 0?a:Math.max(0,a-(t-i)))*2>e.length-n.byteOffset&&Y(`paint graph`,`node records are truncated`);let o=[];for(let l=0;l<a;l+=1){let u=n.readByte(`paint node header`),d=u&3,f=u&4?n.readVarUint32.bind(n):null;if(d===uf){u&248&&Y(`paint graph`,`unsupported draw flag bits`),r+=n.readZigzagVarint(),r<0&&Y(`paint graph`,`run index is negative`);let e={kind:`draw`,runIndex:r};f&&(e.optionalContent=f()),o.push(e)}else if(d===ff){u&248&&Y(`paint graph`,`unsupported retained flag bits`);let e={kind:`retained`,retainedPage:n.readVarUint32(),firstCommand:n.readVarUint32(),count:n.readVarUint32(),rasterIndex:n.readVarUint32()};f&&(e.optionalContent=f()),o.push(e)}else if(d===df){let e=s(u);e.children=c(),o.push(e)}else if(d===3&&t!==void 0){u!==3&&Y(`paint graph`,`unsupported repeated group flag bits`);let c=n.readVarUint32();(c<2||c>a-l||c>t-i)&&Y(`paint graph`,`repeated group count exceeds its logical list or source draw runs`);let d=n.readByte(`repeated group header`);((d&3)!==df||d&64)&&Y(`paint graph`,`repeated groups require an unmasked group state`);let f=s(d),p=n.readByte(`repeated draw header`);((p&3)!==uf||p&248)&&Y(`paint graph`,`invalid repeated draw flags`);let m=r+n.readZigzagVarint();(m<0||m+c>t)&&Y(`paint graph`,`repeated groups reference unknown source draw runs`);let h=p&4?n.readVarUint32():void 0;n.byteOffset>e.length&&Y(`paint graph`,`repeated draw data is truncated`),i+=c,r=m+c-1;for(let e=0;e<c;e+=1){let t={kind:`draw`,runIndex:m+e};h!==void 0&&(t.optionalContent=h);let n={...f,children:[t]};f.bounds&&(n.bounds={...f.bounds}),o.push(n)}l+=c-1}else Y(`paint graph`,`unknown node kind`)}return o},l=c();return n.expectEnd(sf),{roots:l}}var wf=4294967295,Tf=new Uint8Array(new Uint32Array([1]).buffer)[0]===1;function Ef(e){let{gradientMeshRanges:t,gradientMeshPositions:n,gradientMeshColors:r,gradientMeshIndices:i}=e;if([t,n,r,i].filter(e=>e!==void 0).length===0){for(let t=0;t<e.gradientCount;t++)if(e.gradientMetaA[t*4]===2)throw Error(`Missing gradient mesh resources.`);return}if(!(t instanceof Uint32Array)||!(n instanceof Float32Array)||!(r instanceof Float32Array)||!(i instanceof Uint32Array)||t.length!==e.gradientCount*2||n.length%2||r.length!==n.length*2||i.length%3||n.byteLength>wf||r.byteLength>wf||i.byteLength>wf||!n.every(Number.isFinite)||!r.every(e=>Number.isFinite(e)&&e>=0&&e<=1))throw Error(`Invalid gradient mesh resources.`);let a=n.length/2;if(i.some(e=>e>=a))throw Error(`Gradient mesh references an unknown vertex.`);for(let n=0;n<e.gradientCount;n++){let r=t[n*2],a=t[n*2+1];if(r%3||a%3||r>i.length||a>i.length-r||(e.gradientMetaA[n*4]===2?a===0:a!==0))throw Error(`Invalid gradient mesh range.`)}}function Df(e,t){if(Ef(t),!t.gradientMeshRanges)return;let n={rangesFile:`mesh/gradient-ranges.u32`,positionsFile:`mesh/gradient-positions.f32`,colorsFile:`mesh/gradient-colors.f32`,indicesFile:`mesh/gradient-indices.u32`,vertexCount:t.gradientMeshPositions.length/2,indexCount:t.gradientMeshIndices.length},r=(t,n)=>{if(Tf)e.file(t,new Uint8Array(n.buffer,n.byteOffset,n.byteLength));else{let r=new Uint8Array(n.byteLength),i=new DataView(r.buffer);for(let e=0;e<n.length;e++)n instanceof Float32Array?i.setFloat32(e*4,n[e],!0):i.setUint32(e*4,n[e],!0);e.file(t,r)}};return r(n.rangesFile,t.gradientMeshRanges),r(n.positionsFile,t.gradientMeshPositions),r(n.colorsFile,t.gradientMeshColors),r(n.indicesFile,t.gradientMeshIndices),n}async function Of(e,t,n,r){if(t===void 0)return{};if(!t||typeof t!=`object`)throw Error(`Invalid gradient mesh section.`);let i=t;if(!Number.isSafeInteger(i.vertexCount)||i.vertexCount<0||i.vertexCount*16>wf||!Number.isSafeInteger(i.indexCount)||i.indexCount<0||i.indexCount*4>wf||i.indexCount%3||![i.rangesFile,i.positionsFile,i.colorsFile,i.indicesFile].every(e=>typeof e==`string`&&e))throw Error(`Invalid gradient mesh section metadata.`);let a=async(t,n,i)=>{r?.throwIfAborted();let a=e.file(t);if(!a||a.uncompressedSize!==n*4)throw Error(`Missing or incorrectly sized gradient mesh payload.`);let o=await a.async(`arraybuffer`);if(r?.throwIfAborted(),!Tf){let e=new Uint8Array(o);for(let t=0;t<e.length;t+=4){let n=e[t],r=e[t+1];e[t]=e[t+3],e[t+1]=e[t+2],e[t+2]=r,e[t+3]=n}}return new i(o)};return{gradientMeshRanges:await a(i.rangesFile,n*2,Uint32Array),gradientMeshPositions:await a(i.positionsFile,i.vertexCount*2,Float32Array),gradientMeshColors:await a(i.colorsFile,i.vertexCount*4,Float32Array),gradientMeshIndices:await a(i.indicesFile,i.indexCount,Uint32Array)}}function kf(){let e=globalThis.process;if(!e?.versions?.node)return null;if(typeof e.getBuiltinModule!=`function`)throw Error(`HEPR Node.js raster operations require Node.js 22.13 or newer.`);try{return e.getBuiltinModule(`module`).createRequire(import.meta.url)(`@napi-rs/canvas`)}catch(e){throw Error(`Unable to load the optional Node.js canvas backend. Install it with "npm install @napi-rs/canvas".`,{cause:e})}}var Af=.8,jf=Af*100,Mf,Nf,Pf=!1;async function Ff(e,t,n){let{webp:r,png:i}=await ep(e,t,n,[`webp`,`png`],(r,i)=>r!==`png`||!i.webp||Wf(e,t,n,i.webp.byteLength));return{webp:r&&ip(`webp`,r,e,t)?r:null,png:i&&ip(`png`,i,e,t)?i:null}}var If=65536,Lf=1<<20,Rf=1.2,zf=2.5,Bf=32,Vf=4,Hf=8;function Uf(e,t){if(e*t<If)return null;if(e*t>=Lf&&t>=1024)return{bands:Bf,rows:16,margin:Rf};for(let e of[16,8]){let n=Math.min(Bf,Math.floor(t/(e*Hf)));if(n>=Vf)return{bands:n,rows:e,margin:zf}}return null}async function Wf(e,t,n,r){let i=Uf(e,t);if(!i)return!0;let{bands:a,rows:o,margin:s}=i,c=a*o,l=e*4,u=new Uint8Array(l*c);for(let e=0;e<a;e+=1){let r=Math.floor((t-o)*e/(a-1));u.set(n.subarray(r*l,(r+o)*l),e*o*l)}let{png:d}=await ep(e,c,u,[`png`]);return!d||d.byteLength*(t/c)<r*s}function Gf(e,t,{webp:n,png:r}){let i=r&&(!n||r.byteLength<n.byteLength)?{bytes:r,encoding:`png`}:n?{bytes:n,encoding:`webp`}:null;return!i||i.bytes.byteLength>=e*t*4?null:i}async function Kf(e,t,n){let{png:r}=await ep(e,t,n,[`png`]);return r&&ip(`png`,r,e,t)&&r.byteLength<e*t*4?r:null}async function qf(e,t){if(!Jf(e,t))return null;let n=new Uint8Array(t.buffer,t.byteOffset,t.byteLength);if(typeof document>`u`){let e=await fp();if(!e?.loadImage){if(Nf)throw Nf;return null}try{let t=await e.loadImage(n),r=Math.max(0,Math.trunc(t.width)),i=Math.max(0,Math.trunc(t.height));if(r<=0||i<=0)return null;let a=e.createCanvas(r,i);try{let e=a.getContext(`2d`);if(!e)return null;e.drawImage(t,0,0);let n=e.getImageData(0,0,r,i);return{width:r,height:i,data:new Uint8Array(n.data)}}finally{a.width=0,a.height=0}}catch{return null}}if(typeof createImageBitmap!=`function`)return null;let r=n.slice(),i=new Blob([r],{type:$f(e)}),a;try{a=await createImageBitmap(i)}catch{return null}try{let e=a.width,t=a.height;if(e<=0||t<=0)return null;let n=document.createElement(`canvas`);n.width=e,n.height=t;let r=n.getContext(`2d`,{alpha:!0,willReadFrequently:!0});if(!r)return n.width=0,n.height=0,null;r.drawImage(a,0,0);let i=r.getImageData(0,0,e,t),o=new Uint8Array(i.data);return n.width=0,n.height=0,{width:e,height:t,data:o}}finally{a.close()}}function Jf(e,t){if(e===`jpeg`)return t.byteLength>=3&&t[0]===255&&t[1]===216&&t[2]===255;if(e===`png`){let e=[137,80,78,71,13,10,26,10];return t.byteLength>=e.length&&e.every((e,n)=>t[n]===e)}return t.byteLength>=12&&t[0]===82&&t[1]===73&&t[2]===70&&t[3]===70&&t[8]===87&&t[9]===69&&t[10]===66&&t[11]===80}function Yf(e,t){if(!Jf(e,t))return null;if(e===`jpeg`)return Xf(t);if(e===`png`)return t.byteLength<24||up(t,8)!==13||t[12]!==73||t[13]!==72||t[14]!==68||t[15]!==82?null:ap(up(t,16),up(t,20));if(t.byteLength<20)return null;let n=lp(t,4)+8;if(!Number.isSafeInteger(n)||n>t.byteLength)return null;let r=lp(t,16);if(!Number.isSafeInteger(r)||20+r>t.byteLength)return null;let i=String.fromCharCode(t[12],t[13],t[14],t[15]);if(i===`VP8 `)return r<10||t.byteLength<30||t[23]!==157||t[24]!==1||t[25]!==42?null:ap(op(t,26)&16383,op(t,28)&16383);if(i===`VP8L`){if(r<5||t.byteLength<25||t[20]!==47)return null;let e=lp(t,21);return e>>>29?null:ap((e&16383)+1,(e>>>14&16383)+1)}return i===`VP8X`?r<10||t.byteLength<30?null:ap(cp(t,24)+1,cp(t,27)+1):null}function Xf(e){if(!Jf(`jpeg`,e))return null;let t=2;for(let n=0;n<4096&&t<e.byteLength;){if(e[t]!==255)return null;for(;t<e.byteLength&&e[t]===255;)t+=1;if(t>=e.byteLength)return null;let r=e[t];if(t+=1,n+=1,r===0||r===217||r===218)return null;if(r===216||r===1||r>=208&&r<=215)continue;if(t+2>e.byteLength)return null;let i=sp(e,t);if(i<2||t+i>e.byteLength)return null;if(Zf(r))return i<8?null:ap(sp(e,t+5),sp(e,t+3));t+=i}return null}function Zf(e){return e>=192&&e<=207&&e!==196&&e!==200&&e!==204}function Qf(e){let t=e.toLowerCase();return t.endsWith(`.webp`)?`webp`:t.endsWith(`.png`)?`png`:t.endsWith(`.jpg`)||t.endsWith(`.jpeg`)?`jpeg`:null}function $f(e){return e===`webp`?`image/webp`:e===`png`?`image/png`:`image/jpeg`}async function ep(e,t,n,r,i){let a={webp:null,png:null},o=e*t*4;if(!Number.isSafeInteger(o)||e<=0||t<=0||n.byteLength<o)return a;if(typeof document>`u`)return dp(e,t,n,r,i);let s=document.createElement(`canvas`);s.width=e,s.height=t;try{let c=s.getContext(`2d`,{alpha:!0});if(!c)return a;c.putImageData(new ImageData(tp(n,o),e,t),0,0);for(let e of r){if(i&&!await i(e,a))continue;let t=await new Promise(t=>{s.toBlob(t,$f(e),e===`webp`?Af:void 0)});t?.type===$f(e)&&(a[e]=new Uint8Array(await t.arrayBuffer()))}return a}finally{s.width=0,s.height=0}}function tp(e,t){return e.buffer instanceof ArrayBuffer?new Uint8ClampedArray(e.buffer,e.byteOffset,t):new Uint8ClampedArray(e.subarray(0,t))}var np=1048576;function rp(e,t,n,r,i){let a=n*4,o=Math.max(1,Math.min(r,Math.floor(np/a)));if(o<r){let s=new e.ImageData(tp(i,a*o),n,o),c=s.data;if((c instanceof Uint8Array||c instanceof Uint8ClampedArray)&&c.length===a*o&&s.data===c&&c.buffer!==i.buffer){for(let e=0;e<r;e+=o)c.set(i.subarray(e*a,Math.min(r,e+o)*a)),t.putImageData(s,0,e);return}}t.putImageData(new e.ImageData(tp(i,a*r),n,r),0,0)}function ip(e,t,n,r){let i=Yf(e,t);return i?.width===n&&i.height===r}function ap(e,t){return Number.isSafeInteger(e)&&Number.isSafeInteger(t)&&e>0&&t>0?{width:e,height:t}:null}function op(e,t){return e[t]|e[t+1]<<8}function sp(e,t){return e[t]<<8|e[t+1]}function cp(e,t){return e[t]|e[t+1]<<8|e[t+2]<<16}function lp(e,t){return(e[t]|e[t+1]<<8|e[t+2]<<16|e[t+3]<<24)>>>0}function up(e,t){return(e[t]<<24|e[t+1]<<16|e[t+2]<<8|e[t+3])>>>0}async function dp(e,t,n,r,i){let a={webp:null,png:null},o=await fp();if(!o)return Nf&&!Pf&&(Pf=!0,console.warn(`[HEPR] WARNING: The optional @napi-rs/canvas backend is unavailable. Storing raster images as raw RGBA instead of WebP/PNG can make generated HEP files much larger. Install it with "npm install @napi-rs/canvas" and regenerate the HEP files.`)),a;let s=o.createCanvas(e,t);try{let c=s.getContext(`2d`);if(!c)return a;rp(o,c,e,t,n);for(let e of r)if(!i||await i(e,a))try{let t=new Uint8Array(e===`webp`?await s.encode(e,jf):await s.encode(e));Jf(e,t)&&(a[e]=t)}catch{}return a}catch{return a}finally{s.width=0,s.height=0}}async function fp(){if(Mf!==void 0)return Mf;try{let e=kf();return typeof e?.createCanvas!=`function`||typeof e?.ImageData!=`function`?(Mf=null,null):(Mf={createCanvas:e.createCanvas,ImageData:e.ImageData,loadImage:typeof e.loadImage==`function`?e.loadImage:void 0},Mf)}catch(e){return Nf=e,Mf=null,null}}var pp=8,mp=2147483647;function hp(e){throw Error(`Invalid HEP monochrome raster section: ${e}.`)}function gp(e,t){(!Number.isSafeInteger(e)||e<1||e>mp||!Number.isSafeInteger(t)||t<1||t>mp)&&hp(`dimensions are out of range`);let n=pp+Math.ceil(e/8)*t;return Number.isSafeInteger(n)||hp(`byte length is out of range`),n}function _p(e,t,n,r){r?.throwIfAborted();let i=gp(t,n);(!(e.colors instanceof Uint8Array)||e.colors.length!==pp)&&hp(`palette must contain exactly two RGBA colors`),(!(e.data instanceof Uint8Array)||e.data.length!==i-pp)&&hp(`packed byte length does not match its dimensions`);let a=new Uint8Array(i);return a.set(e.colors),a.set(e.data,pp),a}function vp(e,t,n){let r=gp(t,n);return(!(e instanceof Uint8Array)||e.length!==r)&&hp(`byte length does not match its dimensions`),{colors:e.subarray(0,pp),data:e.subarray(pp)}}var yp=Uint8Array.of(72,66,82,49),bp=new Uint8Array(256),xp=new Uint8Array(2048);for(let e=0;e<256;e++){let t=e>>>7,n=0,r=0;for(let i=7;i>=0;i--){let a=e>>>i&1;a!==t&&(xp[e*8+n++]=r,t=a,r=0),r++}xp[e*8+n++]=r,bp[e]=n}function Sp(e){throw Error(`Invalid HEP binary raster section: ${e}.`)}function Cp(e,t){let n=gp(e,t);return n>4294967295&&Sp(`byte length is out of range`),n-1}function wp(e,t,n,r){let i=e[t]??0,a=e[t+n]??0,o=e[t+n*2]??0,s=e[t+n*3]??0,c=e[t+n*4]??0,l=e[t+n*5]??0,u=e[t+n*6]??0,d=e[t+n*7]??0,f;return(i|a|o|s|c|l|u|d)===0?(r.fill(0),0):(i&a&o&s&c&l&u&d)===255?(r.fill(255),255):(f=(i^a>>>1)&85,i^=f,a^=f<<1,f=(o^s>>>1)&85,o^=f,s^=f<<1,f=(c^l>>>1)&85,c^=f,l^=f<<1,f=(u^d>>>1)&85,u^=f,d^=f<<1,f=(i^o>>>2)&51,i^=f,o^=f<<2,f=(a^s>>>2)&51,a^=f,s^=f<<2,f=(c^u>>>2)&51,c^=f,u^=f<<2,f=(l^d>>>2)&51,l^=f,d^=f<<2,f=(i^c>>>4)&15,i^=f,c^=f<<4,f=(a^l>>>4)&15,a^=f,l^=f<<4,f=(o^u>>>4)&15,o^=f,u^=f<<4,f=(s^d>>>4)&15,s^=f,d^=f<<4,r[0]=i,r[1]=a,r[2]=o,r[3]=s,r[4]=c,r[5]=l,r[6]=u,r[7]=d,-1)}function Tp(e,t,n,r){r?.throwIfAborted();let i=Cp(t,n),a=Math.ceil(t/8);if((!(e.colors instanceof Uint8Array)||e.colors.length!==8)&&Sp(`palette must contain two RGBA colors`),(!(e.data instanceof Uint8Array)||e.data.length!==a*n)&&Sp(`packed byte length does not match its dimensions`),i<18)return;let o=new Uint8Array(i),s=new Uint8Array(8);o.set(yp),o.set(e.colors,4);let c=17,l=-1,u=0,d=0,f=()=>{let e=u;do{if(c===i)return!1;o[c++]=e%128|(e>=128?128:0),e=Math.floor(e/128)}while(e);return!0};for(let t=0;t<n;t+=8)for(let n=0;n<a;n++){d++&255||r?.throwIfAborted();let i=wp(e.data,t*a+n,a,s);if(i>=0){let e=i>>>7;if(l<0)l=e,o[16]=l;else if(l!==e){if(!f())return;l=e,u=0}u+=64;continue}for(let e of s){let t=e>>>7;if(l<0)l=t,o[16]=l;else if(l!==t){if(!f())return;l=t,u=0}if(e===0||e===255){u+=8;continue}let n=bp[e];for(let t=0;t<n;t++)if(u+=xp[e*8+t],t+1<n){if(!f())return;l^=1,u=0}}}if(f())return r?.throwIfAborted(),o.slice(0,c)}function Ep(e,t,n,r){r?.throwIfAborted();let i=Cp(t,n),a=Math.ceil(t/8);(!(e instanceof Uint8Array)||e.length<18||e.length>i)&&Sp(`byte length is out of range`),yp.some((t,n)=>e[n]!==t)&&Sp(`invalid header`),e.subarray(12,16).some(e=>e!==0)&&Sp(`reserved header bytes must be zero`);let o=e[16];o>1&&Sp(`initial bit must be zero or one`);let s=a*Math.ceil(n/8)*64;Number.isSafeInteger(s)||Sp(`transposed bit length is out of range`);let c=new Uint8Array(a*n),l=new Uint8Array(8),u=o?255:0;u&&c.fill(u);let d=17,f=0,p=0,m=()=>{let t=0,n=1,r=0,i;do d===e.length&&Sp(`truncated run length`),i=e[d++],t+=(i&127)*n,(!Number.isSafeInteger(t)||t>s-f)&&Sp(`run exceeds the transposed pixel limit`),n*=128,++r>8&&Sp(`run length is out of range`);while(i&128);return t===0&&Sp(`empty runs are invalid`),r>1&&i===0&&Sp(`run length is not canonical`),t},h=m();for(let e=0;e<n;e+=8)for(let t=0;t<a;t++){if(p++&255||r?.throwIfAborted(),h===0&&(o^=1,h=m()),h>=64){let r=o?255:0;if(r&&e+8>n&&Sp(`padded final rows must be zero`),r!==u)for(let i=0;i<8&&e+i<n;i++)c[(e+i)*a+t]=r;h-=64,f+=64;continue}l.fill(0);for(let e=0;e<64;){h===0&&(o^=1,h=m());let t=Math.min(h,64-e),n=e+t;if(o){let t=e>>>3,r=n-1>>>3;t===r?l[t]|=255>>>(e&7)&255<<7-(n-1&7):(l[t]|=255>>>(e&7),l.fill(255,t+1,r),l[r]|=255<<7-(n-1&7))}e=n,h-=t,f+=t}wp(l,0,1,l);for(let r=0;r<8;r++)e+r<n?c[(e+r)*a+t]=l[r]:l[r]!==0&&Sp(`padded final rows must be zero`)}return(h!==0||f!==s)&&Sp(`run stream does not match its dimensions`),d!==e.length&&Sp(`trailing run data`),r?.throwIfAborted(),{data:c,colors:e.subarray(4,12)}}var Dp=2**53-1,Op=Uint8Array.of(72,74,66,49),kp=4294967295;function Ap(e){throw Error(`Invalid HEP JBIG2 raster section: ${e}.`)}function jp(e,t){return(!Number.isSafeInteger(e)||e<0||e>kp)&&Ap(`${t} is out of range`),e}function Mp(e,t){return gp(e,t)-8}function Np(e){return jp(e,`globals index`),e===4294967295&&Ap(`globals index is reserved`),`raster/jbig2-globals-${e}.bin`}function Pp(e,t,n,r){let i=Mp(t,n);(!Number.isSafeInteger(r)||r<1)&&Ap(`decode byte budget is out of range`),(!(e instanceof Uint8Array)||e.length<40||Op.some((t,n)=>e[n]!==t))&&Ap(`header is invalid`),(e[4]&-2||e[5]||e[6]||e[7])&&Ap(`header has reserved flag bits`);let a=new DataView(e.buffer,e.byteOffset,e.byteLength);a.getUint32(36,!0)!==0&&Ap(`header has reserved bytes`);let o=a.getUint32(16,!0),s=a.getUint32(20,!0),c=a.getUint32(24,!0);return(o===0||40+o!==e.length)&&Ap(`encoded byte length does not fill the section`),s===0!=(c===4294967295)&&Ap(`globals reference does not match its length`),(e.length>r||i+o+s>r)&&Ap(`encoded data and packed pixels exceed the decode byte budget`),{encoded:e.subarray(40),colors:e.subarray(8,16),invert:!!(e[4]&1),globalsIndex:c,globalsLength:s,packedHash:[a.getUint32(28,!0),a.getUint32(32,!0)]}}async function Fp(t,n,r,i,a,o){o?.throwIfAborted();let s=Pp(t,r,i,a);(!(n instanceof Uint8Array)||n.length!==s.globalsLength)&&Ap(`globals byte length does not match its reference`);let{decodeBundledJbig2:c}=await e(async()=>{let{decodeBundledJbig2:e}=await import(`./nativeJbig2Codec-e77gM8G8.js`);return{decodeBundledJbig2:e}},__vite__mapDeps([12,1,3,13,14]),import.meta.url);o?.throwIfAborted();let l=await c({codec:`jbig2`,width:r,height:i,components:1,bitsPerComponent:1,imageMask:!1,encoded:s.encoded,globals:n,decodeParameters:{}},a,o),u=l.samples,d=Math.ceil(r/8),f=255<<8-(r&7);for(let e=0;e<i;e++){if(e&63||o?.throwIfAborted(),s.invert){let t=(e+1)*d;for(let n=e*d;n<t;n++)u[n]^=255}r&7&&(u[(e+1)*d-1]&=f)}let p=me(u,r,i);return o?.throwIfAborted(),(p[0]!==s.packedHash[0]||p[1]!==s.packedHash[1])&&Ap(`decoded packed pixels do not match their stored hash`),{data:u,colors:new Uint8Array(s.colors),...!s.invert&&l.jbig2Symbols?{symbols:l.jbig2Symbols}:{}}}var Ip=new WeakSet;function Lp(e){return Ip.add(e),e}function Rp(e){return typeof e==`function`&&Ip.has(e)}var zp=new Uint32Array(Uint8Array.of(1,0,0,0).buffer)[0]===1,Bp=2166136261,Vp=2654435769,Hp=(e,t)=>Math.imul(e^t,16777619),Up=(e,t)=>Math.imul(e^(t>>>16|t<<16),2246822507);function Wp(e,t,n,r){return Kp(e,t,n,!1,r)}function Gp(e,t,n,r){return Kp(e,t,n,!0,r)}function Kp(e,t,n,r,i){i?.throwIfAborted();let a=t*n,o=a*(r?1:4);if(!(e instanceof Uint8Array)||!Number.isSafeInteger(t)||!Number.isSafeInteger(n)||t<1||n<1||!Number.isSafeInteger(o)||e.length<o)throw RangeError(`Invalid source JPEG 2000 RGBA dimensions or pixels.`);let s=Bp,c=Vp;for(let e of[t>>>0,Math.floor(t/4294967296),n>>>0,Math.floor(n/4294967296)])s=Hp(s,e),c=Up(c,e);let l=!r&&zp&&!(e.byteOffset&3)?new Uint32Array(e.buffer,e.byteOffset,a):void 0,u=l||r?void 0:new DataView(e.buffer,e.byteOffset,o);for(let t=0;t<a;t++){t&65535||i?.throwIfAborted();let n=r?4278190080|e[t]*65793:l?l[t]:u.getUint32(t*4,!0);s=Hp(s,n),c=Up(c,n)}return i?.throwIfAborted(),[s>>>0,c>>>0]}function qp(e,t){if(t?.throwIfAborted(),!(e instanceof Uint8Array))throw TypeError(`Invalid source JPEG 2000 encoded bytes.`);let n=Hp(Bp,e.length),r=Up(Vp,e.length);for(let i=0;i<e.length;i++)i&65535||t?.throwIfAborted(),n=Hp(n,e[i]),r=Up(r,e[i]);return t?.throwIfAborted(),[n>>>0,r>>>0]}function Jp(e){if(!e||typeof e!=`object`)return!1;let t=e,n=e=>typeof e==`number`&&Number.isInteger(e)&&e>=0&&e<=4294967295,r=e=>Array.isArray(e)&&e.length===2&&n(e[0])&&n(e[1]);return Number.isSafeInteger(t.width)&&Number.isSafeInteger(t.height)&&t.width>0&&t.height>0&&t.width<=4294967295&&t.height<=4294967295&&Number.isSafeInteger(t.width*t.height*4)&&(t.components===1||t.components===3)&&t.encoded instanceof Uint8Array&&t.encoded.length>0&&r(t.rgbaHash)&&r(t.encodedHash)}var Yp=Uint8Array.of(72,74,80,49),Xp=4294967295;function Zp(e){throw Error(`Invalid HEP JPEG 2000 raster section: ${e}.`)}function Qp(e,t,n=!1){(!Number.isSafeInteger(e)||e<+!!n||e>Xp)&&Zp(`${t} is out of range`)}function $p(e,t){Qp(e,`width`,!0),Qp(t,`height`,!0);let n=e*t*4;return Number.isSafeInteger(n)||Zp(`decoded RGBA length is out of range`),n}function em(e){$p(e.width,e.height),e.components!==1&&e.components!==3&&Zp(`unsupported component count`),(!(e.encoded instanceof Uint8Array)||e.encoded.length===0||e.encoded.length>4294967263)&&Zp(`encoded length is out of range`),(!Array.isArray(e.rgbaHash)||e.rgbaHash.length!==2)&&Zp(`RGBA fingerprint is invalid`),Qp(e.rgbaHash[0],`RGBA fingerprint`),Qp(e.rgbaHash[1],`RGBA fingerprint`),(!Array.isArray(e.encodedHash)||e.encodedHash.length!==2)&&Zp(`encoded fingerprint is invalid`),Qp(e.encodedHash[0],`encoded fingerprint`),Qp(e.encodedHash[1],`encoded fingerprint`);let t=new Uint8Array(32+e.encoded.length),n=new DataView(t.buffer);return t.set(Yp),t[5]=e.components,n.setUint32(8,e.width,!0),n.setUint32(12,e.height,!0),n.setUint32(16,e.encoded.length,!0),n.setUint32(20,e.rgbaHash[0],!0),n.setUint32(24,e.rgbaHash[1],!0),t.set(e.encoded,32),t}async function tm(t,n,r,i){i?.throwIfAborted(),$p(n,r),(!(t instanceof Uint8Array)||t.length<32||Yp.some((e,n)=>t[n]!==e))&&Zp(`header is invalid`),(t[4]||t[6]||t[7])&&Zp(`header has reserved flags`);let a=t[5];a!==1&&a!==3&&Zp(`unsupported component count`);let o=new DataView(t.buffer,t.byteOffset,t.byteLength);o.getUint32(28,!0)!==0&&Zp(`header has reserved bytes`),(o.getUint32(8,!0)!==n||o.getUint32(12,!0)!==r)&&Zp(`dimensions disagree with the raster layer`);let s=o.getUint32(16,!0);(!s||32+s!==t.length)&&Zp(`encoded length does not fill the section`);let c=t.subarray(32),{readJpxProperties:l}=await e(async()=>{let{readJpxProperties:e}=await import(`./nativeJpxCodec-BBLArgL8.js`);return{readJpxProperties:e}},__vite__mapDeps([15,1,3,13]),import.meta.url);i?.throwIfAborted();let u=l(c);return(u.width!==n||u.height!==r||u.components!==a)&&Zp(`codestream dimensions or components disagree with the envelope`),u.unsignedBytes||Zp(`codestream must use unsigned eight-bit samples`),i?.throwIfAborted(),{width:n,height:r,components:a,encoded:c,encodedHash:qp(c,i),rgbaHash:[o.getUint32(20,!0),o.getUint32(24,!0)]}}async function nm(t,n,r,i){i?.throwIfAborted();let a=await tm(t,n,r,i),{decodeBundledJpx:o}=await e(async()=>{let{decodeBundledJpx:e}=await import(`./nativeJpxCodec-BBLArgL8.js`);return{decodeBundledJpx:e}},__vite__mapDeps([15,1,3,13]),import.meta.url);i?.throwIfAborted();let s=await o({codec:`jpeg2000`,encoded:a.encoded,width:n,height:r,components:a.components,bitsPerComponent:8,imageMask:!1,globals:new Uint8Array,decodeParameters:{}},2**53-1,i);i?.throwIfAborted();let c=n*r,l=a.components;(s.width!==n||s.height!==r||s.components!==l||s.bitsPerComponent!==8||!(s.samples instanceof Uint8Array)||s.samples.length!==c*l)&&Zp(`decoded sample layout disagrees with the envelope`);let u=new Uint8Array($p(n,r)),d=s.samples;for(let e=0;e<c;e++){e&16383||i?.throwIfAborted();let t=e*l,n=e*4;u[n]=d[t],u[n+1]=d[t+(l===1?0:1)],u[n+2]=d[t+(l===1?0:2)],u[n+3]=255}let f=Wp(u,n,r,i);return i?.throwIfAborted(),(f[0]!==a.rgbaHash[0]||f[1]!==a.rgbaHash[1])&&Zp(`decoded pixels do not match their stored RGBA fingerprint`),{data:u,sourceJpx:a}}var rm=`geometry/raster-repeats.f64`;function im(e){throw Error(`Invalid HEP raster repeats section: ${e}.`)}function am(e,t){(!Number.isSafeInteger(e)||e<1||e>4294967295||!Number.isSafeInteger(t)||t<0)&&im(`counts are out of range`);let n=4+e*136+t*16;return Number.isSafeInteger(n)||im(`byte length is out of range`),n}function om(e,t){t?.throwIfAborted();let n=[],r=0;for(let i=0;i<e.length;i++){t?.throwIfAborted();let a=e[i].repeat;if(!a)continue;i>4294967295&&im(`layer index is out of range`),P(a);let o=(a.translations?.length??0)/2;o>4294967295&&im(`translation count is out of range`),r+=o,n.push({index:i,repeat:a})}if(!n.length)return;let i=new Uint8Array(am(n.length,r)),a=new DataView(i.buffer);a.setUint32(0,n.length,!0);let o=4;for(let{index:e,repeat:r}of n){t?.throwIfAborted();let n=(r.translations?.length??0)/2;a.setUint32(o,e,!0),a.setUint32(o+4,n,!0),o+=8;for(let e of[r.transform,r.bounds,[r.xStep,r.yStep,r.xFirst,r.xLast,r.yFirst,r.yLast],r.translations??[]])for(let n of e)t?.throwIfAborted(),a.setFloat64(o,n,!0),o+=8}return{bytes:i,count:n.length,translationCount:r}}function sm(e,t,n,r,i){i?.throwIfAborted(),(!Number.isSafeInteger(t)||t<n||t>4294967295)&&im(`layer count is out of range`),e.length!==am(n,r)&&im(`byte length does not match its counts`);let a=new DataView(e.buffer,e.byteOffset,e.byteLength);a.getUint32(0,!0)!==n&&im(`record count does not match its descriptor`);let o=new Map,s=4,c=-1,l=0,u=t=>{t*8>e.length-s&&im(`truncated record`);let n=new Float64Array(t);for(let e=0;e<t;e++)i?.throwIfAborted(),n[e]=a.getFloat64(s,!0),s+=8;return n};for(let d=0;d<n;d++){i?.throwIfAborted(),s+136>e.length&&im(`truncated record`);let n=a.getUint32(s,!0),d=a.getUint32(s+4,!0);(n<=c||n>=t)&&im(`layer indices must be increasing, unique and in range`),d>r-l&&im(`translation count exceeds its descriptor`),c=n,l+=d,s+=8;let f=u(6),p=u(4),m=u(6),h={transform:f,bounds:p,xStep:m[0],yStep:m[1],xFirst:m[2],xLast:m[3],yFirst:m[4],yLast:m[5],...d?{translations:u(d*2)}:{}};P(h),o.set(n,h)}return(s!==e.length||l!==r)&&im(`trailing data or incorrect translation count`),o}function cm(e){if(e.length===0)return new Float32Array;if(e.length%4!=0)throw Error(`Byte-shuffled float32 payload has invalid length (${e.length}).`);let t=e.length/4,n=new Uint8Array(e.length);for(let r=0;r<4;r+=1){let i=r*t,a=r;for(let r=0;r<t;r+=1)n[a]=e[i+r],a+=4}return new Float32Array(n.buffer)}function lm(e){let t=e.length;if(t===0)return new Uint8Array;let n=new Uint32Array(e.buffer,e.byteOffset,e.length),r=new Uint32Array(t),i=0;for(let e=0;e<t;e+=1){let t=n[e];r[e]=t^i,i=t}return pm(new Uint8Array(r.buffer),t)}function um(e){if(e.length===0)return new Float32Array;if(e.length%4!=0)throw Error(`XOR-delta byte-shuffled float32 payload has invalid length (${e.length}).`);let t=e.length/4,n=mm(e,t),r=new Uint32Array(n.buffer),i=r,a=0;for(let e=0;e<t;e+=1){let t=r[e]^a;i[e]=t,a=t}return new Float32Array(i.buffer)}function dm(e){if(e.length===0)return new Uint8Array;if(e.length%4!=0)throw Error(`Channel-major float32 source length must be divisible by 4 (${e.length}).`);let t=e.length/4,n=new Float32Array(e.length);for(let r=0;r<4;r+=1){let i=r*t,a=r;for(let r=0;r<t;r+=1)n[i+r]=e[a],a+=4}return new Uint8Array(n.buffer)}function fm(e){if(e.length===0)return new Float32Array;if(e.length%16!=0)throw Error(`Channel-major float32 payload has invalid length (${e.length}).`);let t=new Float32Array(e.buffer,e.byteOffset,e.byteLength/4),n=t.length/4,r=new Float32Array(t.length);for(let e=0;e<4;e+=1){let i=e*n,a=e;for(let e=0;e<n;e+=1)r[a]=t[i+e],a+=4}return r}function pm(e,t){let n=new Uint8Array(e.length);for(let r=0;r<4;r+=1){let i=r*t,a=r;for(let r=0;r<t;r+=1)n[i+r]=e[a],a+=4}return n}function mm(e,t){let n=new Uint8Array(e.length);for(let r=0;r<4;r+=1){let i=r*t,a=r;for(let r=0;r<t;r+=1)n[a]=e[i+r],a+=4}return n}var hm=`geometry/raster-layers.varint`,gm=[`rgba`,`png`,`webp`,`atlas`,`mono`,`jbig2`,`binary`,`jpx`],_m=[`rgba`,`png`],vm=3,ym=4,bm=8,xm=16,Sm=32,Cm=64,wm=128,Tm=2147483647;function Em(e){throw Error(`Invalid HEP raster layers section: ${e}.`)}function X(e,t,n,r){return(!Number.isSafeInteger(e)||e<t||e>n)&&Em(`${r} is out of range`),e}function Dm(e,t){return`raster/layer-${e}.${t}`}function Om(e,t){return`raster/atlas-${e}.${t}`}function km(e,t){return e<=2048&&t<=2048&&e*t<=16384}function Am(e){let t=[],n=[],r=0,i=0,a=0;for(let{width:o,height:s}of e){if(!km(o,s)||o<=0||s<=0)throw Error(`A ${o}x${s} image cannot join a raster atlas.`);t.length>0&&r+o>2048&&(i+=a,r=0,a=0),(t.length===0||i+s>2048)&&(t.push({width:0,height:0}),r=0,i=0,a=0);let e=t[t.length-1];n.push({atlas:t.length-1,x:r,y:i}),r+=o,a=Math.max(a,s),e.width=Math.max(e.width,r),e.height=Math.max(e.height,i+s)}return{atlases:t,cells:n}}var jm=class{candidatesByHash=new Map;findOrAdd(e,t,n,r){let i=2166136261,a=Mm(r);if(a)for(let e=0;e<a.length;e+=1)i=Math.imul(i^a[e],16777619);else for(let e=0;e<r.length;e+=1)i=Math.imul(i^r[e],16777619);i=(i^t^Math.imul(n,2654435761))>>>0;let o=this.candidatesByHash.get(i);o||(o=[],this.candidatesByHash.set(i,o));for(let e of o)if(e.width===t&&e.height===n&&Nm(e.rgba,r))return e.index;return o.push({index:e,width:t,height:n,rgba:r}),-1}};function Mm(e){return e.byteOffset%4==0&&e.length%4==0?new Uint32Array(e.buffer,e.byteOffset,e.length/4):null}function Nm(e,t){if(e.length!==t.length)return!1;let n=Mm(e),r=Mm(t);if(n&&r){for(let e=0;e<n.length;e+=1)if(n[e]!==r[e])return!1;return!0}for(let n=0;n<e.length;n+=1)if(e[n]!==t[n])return!1;return!0}function Pm(e,t,n,r,i,a,o,s,c,l){let u=c*4;for(let c=0;c<l;c+=1){let l=((r+c)*t+n)*4;i.set(e.subarray(l,l+u),((s+c)*a+o)*4)}}function Fm({atlases:e,layers:t}){let n=new ts(e.length*8+t.length*12+16);n.writeVarUint32(e.length);for(let t of e){let e=_m.indexOf(t.encoding);e<0&&Em(`unknown atlas encoding ${String(t.encoding)}`),n.writeByte(e),n.writeVarUint32(X(t.width,1,Tm,`atlas width`)),n.writeVarUint32(X(t.height,1,Tm,`atlas height`))}n.writeVarUint32(t.length);let r=new Float32Array(t.length*6),i=0,a=0,o={atlas:-1,right:0,y:0};return t.forEach((s,c)=>{let l=gm.indexOf(s.storage);l<0&&Em(`layer ${c} has unknown storage ${String(s.storage)}`);let u=s.opacity!==void 0;u&&!(Number.isFinite(s.opacity)&&s.opacity>=0&&s.opacity<=1)&&Em(`layer ${c} has an invalid opacity`);let d=s.storage===`mono`?bm:s.storage===`jbig2`?xm:s.storage===`binary`?Sm:s.storage===`jpx`?wm:l,f=s.source!==void 0;if(f&&Im(t,c,s.source,s),n.writeByte(d|(u?ym:0)|(f?Cm:0)),n.writeVarUint32(X(s.width,1,Tm,`layer width`)),n.writeVarUint32(X(s.height,1,Tm,`layer height`)),n.writeZigzagVarint(X(s.paintOrder,0,Tm,`paint order`)-i),n.writeZigzagVarint(X(s.pageIndex,0,Tm,`page index`)-a),i=s.paintOrder,a=s.pageIndex,f&&n.writeVarUint32(c-s.source),s.storage===`atlas`!=(s.cell!==void 0)&&Em(`layer ${c} has a mismatched atlas cell`),s.cell){let{atlas:t,x:r,y:i}=s.cell,a=e[X(t,0,e.length-1,`atlas index`)];X(r,0,a.width-s.width,`cell x`),X(i,0,a.height-s.height,`cell y`);let c=t===o.atlas;n.writeVarUint32(t),n.writeZigzagVarint(r-(c?o.right:0)),n.writeZigzagVarint(i-(c?o.y:0)),o={atlas:t,right:r+s.width,y:i}}u&&n.writeFloat64(s.opacity),s.matrix.length<6&&Em(`layer ${c} has an incomplete matrix`);for(let e=0;e<6;e+=1){let n=s.matrix[e];Number.isFinite(n)||Em(`layer ${c} has a non-finite matrix`),r[e*t.length+c]=n}}),n.writeBytes(lm(r)),n.toUint8Array()}function Im(e,t,n,r){let i=e[X(n,0,t-1,`shared section layer`)];(r.storage===`atlas`||i.source!==void 0||i.storage!==r.storage||i.width!==r.width||i.height!==r.height)&&Em(`layer ${t} shares an incompatible section`)}function Lm(e,t){let n=new ns(e),r=X(n.readVarUint32(),0,t.maxAtlases,`atlas count`);r*3+1>e.length-n.byteOffset&&Em(`atlas records are truncated`);let i=[];for(let e=0;e<r;e+=1){let r=_m[n.readByte(`atlas encoding`)];r||Em(`atlas ${e} has an unknown encoding`);let a=X(n.readVarUint32(),1,t.maxDimension,`atlas width`),o=X(n.readVarUint32(),1,t.maxDimension,`atlas height`);i.push({encoding:r,width:a,height:o})}let a=X(n.readVarUint32(),0,t.maxLayers,`layer count`);a*29>e.length-n.byteOffset&&Em(`layer records or matrices are truncated`);let o=[],s=0,c=0,l={atlas:-1,right:0,y:0};for(let e=0;e<a;e+=1){let a=n.readByte(`raster layer flags`);a&-256&&Em(`layer ${e} has reserved flag bits`);let u=a&184;u&&(a&vm||u&u-1)&&Em(`layer ${e} has conflicting storage flags`);let d=a&wm?`jpx`:a&Sm?`binary`:a&xm?`jbig2`:a&bm?`mono`:gm[a&vm],f=X(n.readVarUint32(),1,t.maxDimension,`layer width`),p=X(n.readVarUint32(),1,t.maxDimension,`layer height`);s=X(s+n.readZigzagVarint(),0,Tm,`paint order`),c=X(c+n.readZigzagVarint(),0,Tm,`page index`);let m={width:f,height:p,matrix:new Float32Array(6),paintOrder:s,pageIndex:c,storage:d};if(a&Cm&&(m.source=e-X(n.readVarUint32(),1,e,`shared section distance`),Im(o,e,m.source,m)),d===`atlas`){let e=X(n.readVarUint32(),0,r-1,`atlas index`),t=e===l.atlas,a=X(n.readZigzagVarint()+(t?l.right:0),0,i[e].width-f,`cell x`),o=X(n.readZigzagVarint()+(t?l.y:0),0,i[e].height-p,`cell y`);m.cell={atlas:e,x:a,y:o},l={atlas:e,right:a+f,y:o}}if(a&ym){let t=n.readFloat64(`raster layer opacity`);Number.isFinite(t)&&t>=0&&t<=1||Em(`layer ${e} has an invalid opacity`),m.opacity=t}o.push(m)}let u=n.byteOffset;e.length-u!==a*24&&Em(`matrix data does not fill the section`);let d=um(e.subarray(u));for(let e=0;e<a;e+=1){let t=o[e].matrix;for(let n=0;n<6;n+=1)t[n]=d[n*a+e],Number.isFinite(t[n])||Em(`layer ${e} has a non-finite matrix`)}return{atlases:i,layers:o}}var Rm=`geometry/text-glyph-segments.cq16`,zm=`geometry/text-instance-ef.pd512`,Bm=4294967295,Vm=65535;function Hm(e,t){throw Error(`Invalid HEP ${e} section: ${t}.`)}function Um(e,t,n,r){let i=1/0,a=-1/0,o=e=>{Number.isFinite(e)&&(e<i&&(i=e),e>a&&(a=e))};for(let i=0;i<n;i+=1)o(e[i*4+r]),o(e[i*4+2+r]),o(t[i*4+r]);return Number.isFinite(i)?[i,a]:[0,0]}function Wm(e,t,n){if((!Number.isSafeInteger(n)||n<0||n>Bm)&&Hm(`text glyph segments`,`segment count exceeds its uint32 range`),e.length<n*4||t.length<n*4)throw Error(`Text glyph segments have insufficient data for ${n} segments.`);let[r,i]=Um(e,t,n,0),[a,o]=Um(e,t,n,1),s=Math.ceil(n/8),c=new Uint8Array(s),l=new Uint8Array(s),u=Array.from({length:6},()=>new ts(n+16)),d=0,f=0;for(let s=0;s<n;s+=1){let n=s*4,p=$o(e[n],r,i),m=$o(e[n+1],a,o),h=$o(e[n+2],r,i),g=$o(e[n+3],a,o),_=$o(t[n],r,i),v=$o(t[n+1],a,o),y=t[n+2]>=.5;u[0].writeZigzagVarint(p-d),u[1].writeZigzagVarint(m-f),u[2].writeZigzagVarint(_-p),u[3].writeZigzagVarint(v-m),y&&(c[Math.floor(s/8)]|=1<<(s&7)),(y||h!==_||g!==v)&&(l[Math.floor(s/8)]|=1<<(s&7),u[4].writeZigzagVarint(h-(p+_>>1)),u[5].writeZigzagVarint(g-(m+v>>1))),d=_,f=v}let p=new ts(s*2+n*4+32);p.writeVarUint32(n),p.writeBytes(c),p.writeBytes(l);let m=u.map(e=>e.toUint8Array());for(let e of m)e.length>Bm&&Hm(`text glyph segments`,`column length exceeds its uint32 range`),p.writeVarUint32(e.length);for(let e of m)p.writeBytes(e);return{bytes:p.toUint8Array(),meta:{file:Rm,segmentCount:n,quantizationMin:[r,a],quantizationMax:[i,o]}}}function Gm(e,t){let n=`text glyph segments`,r=new ns(e),i=r.readVarUint32();i!==t.segmentCount&&Hm(n,`segment count does not match its manifest entry`);let a=Math.ceil(i/8),o=r.byteOffset;o+a*2>e.length&&Hm(n,`bitsets are truncated`);let s=new ns(e,o+a*2),c=Array.from({length:6},()=>s.readVarUint32()),l=s.byteOffset;l+c.reduce((e,t)=>e+t,0)!==e.length&&Hm(n,`column lengths do not fill the section`),c.slice(0,4).some(e=>e<i)&&Hm(n,`point columns are truncated`);let u=c.map(t=>{let n=new ns(e,l,l+t);return l+=t,n}),[d,f]=t.quantizationMin,[p,m]=t.quantizationMax,h=new Float32Array(i*4),g=new Float32Array(i*4),_=e=>((e<0||e>Vm)&&Hm(n,`a point leaves the quantization grid`),e),v=0,y=0;for(let t=0;t<i;t+=1){let r=1<<(t&7),i=Math.floor(t/8),s=(e[o+i]&r)!==0,c=(e[o+a+i]&r)!==0;s&&!c&&Hm(n,`a quadratic has no control point`);let l=_(v+u[0].readZigzagVarint()),b=_(y+u[1].readZigzagVarint()),x=_(l+u[2].readZigzagVarint()),S=_(b+u[3].readZigzagVarint()),C=c?_((l+x>>1)+u[4].readZigzagVarint()):x,w=c?_((b+S>>1)+u[5].readZigzagVarint()):S,T=t*4;h[T]=es(l,d,p),h[T+1]=es(b,f,m),h[T+2]=es(C,d,p),h[T+3]=es(w,f,m),g[T]=es(x,d,p),g[T+1]=es(S,f,m),g[T+2]=+!!s,v=x,y=S}return u.forEach((e,t)=>e.expectEnd(`${n} column ${t}`)),{segmentsA:h,segmentsB:g}}var Km=class{scaleTables=new Map;lastScale=NaN;lastTable=null;state(e,t){if(this.lastTable===null||e!==this.lastScale){let t=this.scaleTables.get(e);t||(t=new Map,this.scaleTables.set(e,t)),this.lastScale=e,this.lastTable=t}let n=this.lastTable.get(t);return n||(n={best:0,bestCount:0,counts:new Map},this.lastTable.set(t,n)),n}static observe(e,t){let n=(e.counts.get(t)??0)+1;e.counts.set(t,n),n>e.bestCount&&(e.best=t,e.bestCount=n)}};function qm(e,t,n,r){let i=rs(t,r,4,1),a=new ts(r+16),o=new ts(r/8+16),s=new Km,c=0,l=0;for(let i=0;i<r;i+=1){let r=Xo(t[i*4]),u=Xo(t[i*4+1]),d=r-c;if(i>0&&u===l){let t=s.state(e[(i-1)*4],n[i-1]);a.writeZigzagVarint(d-t.best|0),Km.observe(t,d)}else o.writeZigzagVarint(d);c=r,l=u}let u=a.toUint8Array(),d=o.toUint8Array(),f=new Uint8Array(i.length+u.length+d.length);return f.set(i,0),f.set(u,i.length),f.set(d,i.length+u.length),{bytes:f,columnByteLengths:[i.length,u.length,d.length]}}function Jm(e,t,n,r,i,a){let o=`text instance positions`,[s,c,l]=t;(t.length!==3||s+c+l!==e.length)&&Hm(o,`column lengths do not fill the section`),(n.length<a*4||r.length<a)&&Hm(o,`instance data is incomplete`);let u=new ns(e,0,s),d=new ns(e,s,s+c),f=new ns(e,s+c,e.length),p=new Km,m=0,h=0;for(let e=0;e<a;e+=1){let t=h+u.readZigzagVarint();if(e>0&&t===h){let t=p.state(n[(e-1)*4],r[e-1]),i=d.readZigzagVarint()+t.best|0;Km.observe(t,i),m+=i}else m+=f.readZigzagVarint();h=t,i[e*4]=m/512,i[e*4+1]=h/512}u.expectEnd(`${o} f column`),d.expectEnd(`${o} advance stream`),f.expectEnd(`${o} jump stream`)}var Ym=`text/text-index.json`,Xm=`text/char-map.bin`,Zm=`text/fallback-quads.d512`,Qm=`text/optional-content.varint`;function $m(e,t){if(!Array.isArray(e)||e.length!==t)return null;let n=[];for(let t of e){let e=Number(t);if(!Number.isFinite(e))return null;n.push(e)}return n}function eh(e){let t=e.manifest,n=t.segmentCount,r=new Float32Array(n*4),i=new Float32Array(n*4);if(n===0)return{endpoints:r,primitiveMeta:i,primitiveBounds:new Float32Array};let a=e.endpointsBytes,o=e.metaBytes,s=t.endpointColumnByteLengths;if(s[0]+s[1]+s[2]+s[3]!==a.length)throw Error(`HEP file stroke endpoint columns have a length mismatch.`);let c=s[0],l=c+s[1],u=l+s[2],d=new ns(a,0,c),f=new ns(a,c,l),p=new ns(a,l,u),m=new ns(a,u,a.length),h=Math.ceil(n/8),g=h,_=h+n*2;if(o.length<_)throw Error(`HEP file stroke meta stream is truncated.`);let v=new ns(o,_,o.length),y=t.quantizationMin,b=t.quantizationMax,x=t.ctrlQuantizationMin,S=t.ctrlQuantizationMax,C=0,w=0,T=0;for(let e=0;e<n;e+=1){let t=d.readZigzagVarint()+C,n=f.readZigzagVarint()+w,a=p.readZigzagVarint()+t,s=m.readZigzagVarint()+n;C=a,w=s;let c=es(t,y[0],b[0]),l=es(n,y[1],b[1]),u=es(a,y[2],b[2]),h=es(s,y[3],b[3]),_=o[Math.floor(e/8)]>>>(e&7)&1,E=e*4;if(r[E]=c,r[E+1]=l,_){T+=1;let e=$o((c+u)*.5,x[0],S[0]),t=$o((l+h)*.5,x[1],S[1]);r[E+2]=es(v.readZigzagVarint()+e,x[0],S[0]),r[E+3]=es(v.readZigzagVarint()+t,x[1],S[1])}else r[E+2]=u,r[E+3]=h;i[E]=u,i[E+1]=h,i[E+2]=_;let D=o[g+e*2]|o[g+e*2+1]<<8;i[E+3]=(D&4095)/4095+(D>>>12)*2}if(d.expectEnd(`stroke start-x column`),f.expectEnd(`stroke start-y column`),p.expectEnd(`stroke end-x column`),m.expectEnd(`stroke end-y column`),v.expectEnd(`stroke control-point stream`),T!==t.curveCount)throw Error(`HEP file stroke curve count mismatch (${T} vs ${t.curveCount}).`);let E=mh(r,i,n);if(t.clipBoundsFile){let r=e.clipBoundsBytes;if(!r)throw Error(`HEP file is missing clipped stroke bounds.`);let a=t.clippedSegmentCount*4*Float32Array.BYTES_PER_ELEMENT;if(r.byteLength!==a)throw Error(`HEP file clipped stroke bounds have a length mismatch.`);let o=new Float32Array(r.buffer,r.byteOffset,r.byteLength/4),s=0;for(let e=0;e<n;e+=1){let n=e*4;if((oh(i[n+3])&ih)===0)continue;if(s>=t.clippedSegmentCount)throw Error(`HEP file clipped stroke count does not match its style flags.`);let r=s*4,a=o[r],c=o[r+1],l=o[r+2],u=o[r+3];if(![a,c,l,u].every(Number.isFinite)||a>l||c>u)throw Error(`HEP file contains invalid clipped stroke bounds.`);E.set(o.subarray(r,r+4),n),s+=1}if(s!==t.clippedSegmentCount)throw Error(`HEP file clipped stroke count does not match its style flags.`)}return{endpoints:r,primitiveMeta:i,primitiveBounds:E}}var th=`geometry/stroke-endpoints.csq16`,nh=`geometry/stroke-meta.bin`,rh=`geometry/stroke-clip-bounds.f32`,ih=4,ah=2;function oh(e){return Number.isFinite(e)?Math.max(0,Math.trunc(e/ah+1e-6)):0}function sh(e){let t=0;for(let n of e)t+=n.length;let n=new Uint8Array(t),r=0;for(let t of e)n.set(t,r),r+=t.length;return n}var ch=new WeakMap,lh=new WeakSet;function uh(e){if(Wi(e),T(e),u(e),Yd(e),ie(e),lh.has(e))return e;let t=dh(e),n=t?eh(t):{},r=(e,t,n)=>{let r=hh(e,t.subarray(0,n*4),`interleaved`);return yh(r.data.buffer.slice(r.data.byteOffset,r.data.byteOffset+r.data.byteLength),{...r,logicalItemCount:n},e)},i=(e,t,n)=>{let r=e.slice(0,t*4);for(let i=0;i<n;i+=1){let n=rs(e,t,4,i);is(n,0,n.length,r,t,4,i)}return r},a=()=>{let t=Wm(e.textGlyphSegmentsA,e.textGlyphSegmentsB,e.textGlyphSegmentCount),n=Gm(t.bytes,t.meta);return{textGlyphSegmentsA:n.segmentsA,textGlyphSegmentsB:n.segmentsB}},o=no(Object.assign(Object.defineProperties({},Object.getOwnPropertyDescriptors(e)),{...n,...e.textGlyphSegmentCount>0?a():{},...e.clipPaths?{clipPaths:e.clipPaths.map(e=>({...e,edges:i(e.edges,e.edges.length/4,4)}))}:{},fillSegmentsA:r(`fill-primitives-a`,e.fillSegmentsA,e.fillSegmentCount),fillSegmentsB:r(`fill-primitives-b`,e.fillSegmentsB,e.fillSegmentCount),textInstanceB:i(e.textInstanceB,e.textInstanceCount,2),textInstanceC:r(`text-instance-c`,e.textInstanceC,e.textInstanceCount),textIndex:e.textIndex?{...e.textIndex,pages:e.textIndex.pages.map(e=>({...e,fallbackQuads:i(e.fallbackQuads,e.fallbackQuads.length/4,4)}))}:null}));return t&&ch.set(o,t),lh.add(o),o}function dh(e){let t=ch.get(e);if(t)return t;let n=Math.max(0,Math.trunc(e.segmentCount));if(n===0)return null;let r=e.endpoints.subarray(0,n*4),i=e.primitiveMeta.subarray(0,n*4),a=_h(r),o=vh(i),s=new Uint16Array(a.data.buffer,a.data.byteOffset,a.data.byteLength/2),c=new Uint16Array(o.data.buffer,o.data.byteOffset,o.data.byteLength/2),l=new ts(n),u=new ts(n),d=new ts(n),f=new ts(n),p=new Uint8Array(Math.ceil(n/8)),m=new ts(256),h=[],g=0,_=0,v=0;for(let t=0;t<n;t+=1){let n=t*4,r=s[n],y=s[n+1],b=c[n],x=c[n+1];if(l.writeZigzagVarint(r-g),u.writeZigzagVarint(y-_),d.writeZigzagVarint(b-r),f.writeZigzagVarint(x-y),g=b,_=x,c[n+2]>=1){p[Math.floor(t/8)]|=1<<(t&7),v+=1;let e=es(r,a.min[0],a.max[0]),i=es(y,a.min[1],a.max[1]),c=es(b,o.min[0],o.max[0]),l=es(x,o.min[1],o.max[1]),u=$o((e+c)*.5,a.min[2],a.max[2]),d=$o((i+l)*.5,a.min[3],a.max[3]);m.writeZigzagVarint(s[n+2]-u),m.writeZigzagVarint(s[n+3]-d)}if((oh(i[n+3])&ih)!==0){if(e.primitiveBounds.length<n+4)throw Error(`Clipped stroke ${t} has no clip bounds.`);let r=e.primitiveBounds[n],i=e.primitiveBounds[n+1],a=e.primitiveBounds[n+2],o=e.primitiveBounds[n+3];if(![r,i,a,o].every(Number.isFinite)||r>a||i>o)throw Error(`Clipped stroke ${t} has invalid clip bounds.`);h.push(r,i,a,o)}}let y=new ts(p.length+n*2+m.length);y.writeBytes(p);for(let e=0;e<n;e+=1)y.writeUint16(c[e*4+3]);y.writeBytes(m.toUint8Array());let b=[l.toUint8Array(),u.toUint8Array(),d.toUint8Array(),f.toUint8Array()],x=h.length/4,S=x>0?Float32Array.from(h):null;return{endpointsBytes:sh(b),metaBytes:y.toUint8Array(),...S?{clipBoundsBytes:new Uint8Array(S.buffer,S.byteOffset,S.byteLength)}:{},manifest:{endpointsFile:th,metaFile:nh,...S?{clipBoundsFile:rh,clippedSegmentCount:x}:{},segmentCount:n,curveCount:v,quantizationMin:[a.min[0],a.min[1],o.min[0],o.min[1]],quantizationMax:[a.max[0],a.max[1],o.max[0],o.max[1]],ctrlQuantizationMin:[a.min[2],a.min[3]],ctrlQuantizationMax:[a.max[2],a.max[3]],endpointColumnByteLengths:b.map(e=>e.length)}}}function fh(e){let t=[];if(Array.isArray(e.rasterLayers))for(let n of e.rasterLayers){let e=Math.max(0,Math.trunc(n?.width??0)),r=Math.max(0,Math.trunc(n?.height??0));if(e<=0||r<=0||(n.monochrome?n.monochrome.data.length!==Math.ceil(e/8)*r||n.monochrome.colors.length!==8:!(n.data instanceof Uint8Array)||n.data.length<e*r*4&&!Bi(n.data)))continue;let i=n.matrix instanceof Float32Array?n.matrix:new Float32Array(n.matrix);t.push(ge(n,{width:e,height:r,matrix:i,paintOrder:Number.isFinite(n.paintOrder)?n.paintOrder:0,pageIndex:Number.isFinite(n.pageIndex)?Math.max(0,Math.trunc(n.pageIndex)):0,...n.opacity===void 0?{}:{opacity:n.opacity}}))}if(t.length>0)return t;let n=Math.max(0,Math.trunc(e.rasterLayerWidth)),r=Math.max(0,Math.trunc(e.rasterLayerHeight));return n<=0||r<=0||e.rasterLayerData.length<n*r*4||t.push({width:n,height:r,data:e.rasterLayerData,matrix:e.rasterLayerMatrix,paintOrder:0,pageIndex:0}),t}function ph(e){return!Number.isFinite(e)||e<0?0:e>1?1:e}function mh(e,t,n){let r=new Float32Array(n*4);for(let i=0;i<n;i+=1){let n=i*4,a=e[n],o=e[n+1],s=e[n+2],c=e[n+3],l=t[n],u=t[n+1];r[n]=Math.min(a,s,l),r[n+1]=Math.min(o,c,u),r[n+2]=Math.max(a,s,l),r[n+3]=Math.max(o,c,u)}return r}function Z(e,t){let n=Number(e);return Number.isFinite(n)?Math.max(0,Math.trunc(n)):Math.max(0,Math.trunc(t))}function hh(e,t,n){if(e===`text-instance-c`)return{data:gh(t),componentType:`uint8-normalized`,layout:`interleaved`,suffix:`.rgba8`};if(e===`text-instance-a`)return{data:lm(t),componentType:`float32`,layout:`interleaved`,suffix:`.f32bs`,byteShuffle:!0,predictor:`xor-delta-u32`};if(e===`fill-primitives-a`||e===`fill-primitives-b`){let e=_h(t),n=new Uint16Array(e.data.buffer,e.data.byteOffset,e.data.byteLength/2),r=Math.floor(t.length/4),i=[],a=[],o=0;for(let e=0;e<4;e+=1){let t=as(n,r,4,e);i.push(t),a.push(t.length),o+=t.length}let s=new Uint8Array(o),c=0;for(let e of i)s.set(e,c),c+=e.length;return{data:s,componentType:`uint16-range-delta-columns`,layout:`interleaved`,suffix:`.q16dc`,quantizationMin:Array.from(e.min),quantizationMax:Array.from(e.max),columnByteLengths:a}}return{data:n===`channel-major`?dm(t):new Uint8Array(t.buffer,t.byteOffset,t.byteLength).slice(),componentType:`float32`,layout:n,suffix:n===`channel-major`?`.f32cm`:`.f32`}}function gh(e){let t=new Uint8Array(e.length);for(let n=0;n<e.length;n+=1){let r=Number.isFinite(e[n])?e[n]:0;t[n]=Math.round(ph(r)*255)}return t}function _h(e){let t=Math.floor(e.length/4),n=new Float32Array([1/0,1/0,1/0,1/0]),r=new Float32Array([-1/0,-1/0,-1/0,-1/0]);for(let i=0;i<t;i+=1){let t=i*4;for(let i=0;i<4;i+=1){let a=e[t+i];Number.isFinite(a)&&(n[i]=Math.min(n[i],a),r[i]=Math.max(r[i],a))}}for(let e=0;e<4;e+=1)(!Number.isFinite(n[e])||!Number.isFinite(r[e]))&&(n[e]=0,r[e]=0);let i=new Uint16Array(e.length);for(let a=0;a<t;a+=1){let t=a*4;for(let a=0;a<4;a+=1)i[t+a]=$o(e[t+a],n[a],r[a])}return{data:new Uint8Array(i.buffer),min:n,max:r}}function vh(e){let t=Math.floor(e.length/4),n=new Float32Array([1/0,1/0,0,0]),r=new Float32Array([-1/0,-1/0,1,0]);for(let i=0;i<t;i+=1){let t=i*4,a=e[t],o=e[t+1];Number.isFinite(a)&&(n[0]=Math.min(n[0],a),r[0]=Math.max(r[0],a)),Number.isFinite(o)&&(n[1]=Math.min(n[1],o),r[1]=Math.max(r[1],o))}for(let e=0;e<2;e+=1)(!Number.isFinite(n[e])||!Number.isFinite(r[e]))&&(n[e]=0,r[e]=0);let i=new Uint16Array(e.length);for(let a=0;a<t;a+=1){let t=a*4;i[t]=$o(e[t],n[0],r[0]),i[t+1]=$o(e[t+1],n[1],r[1]),i[t+2]=+(e[t+2]>=.5);let o=Number.isFinite(e[t+3])?e[t+3]:0,s=Math.min(15,Math.max(0,Math.floor(o/2+1e-6))),c=ph(o-s*2),l=Math.round(c*4095);i[t+3]=s<<12|l}return{data:new Uint8Array(i.buffer),min:n,max:r}}function yh(e,t,n){let r=typeof t.componentType==`string`?t.componentType:`float32`;if(r===`uint8-normalized`)return bh(new Uint8Array(e));if(r===`uint16-range-delta-columns`)return xh(new Uint8Array(e),t,n);if(r!==`float32`)throw Error(`Texture ${n} has unsupported componentType ${String(r)}.`);let i=typeof t.layout==`string`?t.layout:`interleaved`;if(i!==`interleaved`&&i!==`channel-major`)throw Error(`Texture ${n} has unsupported layout ${String(i)}.`);if(i===`channel-major`)return fm(new Uint8Array(e));let a=t.byteShuffle===!0,o=typeof t.predictor==`string`?t.predictor:`none`;if(o!==`none`&&o!==`xor-delta-u32`)throw Error(`Texture ${n} has unsupported predictor ${String(o)}.`);if(a)return o===`xor-delta-u32`?um(new Uint8Array(e)):cm(new Uint8Array(e));if(o!==`none`)throw Error(`Texture ${n} declares predictor ${o} without byteShuffle.`);if(e.byteLength%4!=0)throw Error(`Texture ${n} has invalid byte length (${e.byteLength}).`);return new Float32Array(e)}function bh(e){let t=new Float32Array(e.length);for(let n=0;n<e.length;n+=1)t[n]=e[n]/255;return t}function xh(e,t,n){let r=Sh(t.quantizationMin,n,`quantizationMin`),i=Sh(t.quantizationMax,n,`quantizationMax`),a=Z(t.logicalItemCount,0),o=$m(t.columnByteLengths,4);if(!o||o.some(e=>!Number.isInteger(e)||e<0))throw Error(`Texture ${n} has invalid columnByteLengths.`);if(o[0]+o[1]+o[2]+o[3]!==e.length)throw Error(`Texture ${n} delta columns have a length mismatch.`);let s=new Uint16Array(a*4),c=0;for(let t=0;t<4;t+=1)os(e,c,c+o[t],s,a,4,t),c+=o[t];let l=new Float32Array(a*4);for(let e=0;e<l.length;e+=1){let t=e&3;l[e]=es(s[e],r[t],i[t])}return l}function Sh(e,t,n){if(!Array.isArray(e)||e.length<4)throw Error(`Texture ${t} is missing ${n}.`);let r=new Float32Array(4);for(let i=0;i<4;i+=1){let a=Number(e[i]);if(!Number.isFinite(a))throw Error(`Texture ${t} has invalid ${n}[${i}].`);r[i]=a}return r}async function Ch(e,t){try{let n=typeof t.textIndex==`object`&&t.textIndex?t.textIndex:{},r=typeof n.file==`string`?n.file:Ym,i=e.file(r);if(!i)return null;let a=await i.async(`string`),o=JSON.parse(a),s=Array.isArray(o.pages)?o.pages:[];if(s.length===0)return null;let c=typeof n.charMapFile==`string`?n.charMapFile:Xm,l=e.file(c);return l?await wh(e,n,s,l):null}catch(e){if(t.textIndex&&typeof t.textIndex==`object`&&`optionalContentFile`in t.textIndex)throw e;let n=e instanceof Error?e.message:String(e);return console.warn(`[Parsed data load] Failed to read text index: ${n}`),null}}async function wh(e,t,n,r){let i=new Uint8Array(await r.async(`arraybuffer`)),a;if(t.optionalContentFile!==void 0){if(typeof t.optionalContentFile!=`string`||!t.optionalContentFile)throw Error(`Invalid text optional-content section.`);let n=e.file(t.optionalContentFile);if(!n)throw Error(`Missing text optional-content section.`);a=new ns(new Uint8Array(await n.async(`arraybuffer`)))}let o=0;for(let e of n)o+=Z(e.fallbackCount,0);let s=null;if(o>0){let n=typeof t.fallbackFile==`string`?t.fallbackFile:Zm,r=e.file(n),i=Array.isArray(t.fallbackColumnByteLengths)?t.fallbackColumnByteLengths.map(Number):null;if(!r||!i||i.length!==4||i.some(e=>!Number.isFinite(e)||e<0))return console.warn(`[Parsed data load] Text index fallback quads are missing or invalid; ignoring text index.`),null;let a=new Uint8Array(await r.async(`arraybuffer`));if(i.reduce((e,t)=>e+t,0)!==a.length)return console.warn(`[Parsed data load] Text index fallback quads have a length mismatch; ignoring text index.`),null;s=new Float32Array(o*4);let c=0;for(let e=0;e<4;e+=1)is(a,c,c+i[e],s,o,4,e),c+=i[e]}let c=new ns(i),l=-1,u=0,d=[];for(let e of n){let t=typeof e.text==`string`?e.text:``,n=new Int32Array(t.length),r=0;for(let e=0;e<t.length;e+=1){let t=c.readVarUint32();t===0?n[e]=-1:t===1?(n[e]=-2-r,r+=1):(l=l+1+Qo(t-2),n[e]=l)}if(Z(e.fallbackCount,r)!==r||r>0&&!s)return console.warn(`[Parsed data load] Text index char map is inconsistent; ignoring text index.`),null;let i=s?s.slice(u*4,(u+r)*4):new Float32Array;u+=r;let o=a?new Int32Array(t.length):void 0;if(o)for(let e=0;e<t.length;e++){let t=a.readVarUint32()-1;if(t>2147483647)throw Error(`Invalid text optional-content reference.`);o[e]=t}d.push({text:t,charInstance:n,fallbackQuads:i,...o?{optionalContent:o}:{}})}return c.expectEnd(`text/char-map.bin`),a?.expectEnd(Qm),{version:2,pages:d}}function Th(e){if(typeof e!=`object`||!e)return null;let t=e,n=typeof t.endpointsFile==`string`?t.endpointsFile:null,r=typeof t.metaFile==`string`?t.metaFile:null,i=typeof t.clipBoundsFile==`string`?t.clipBoundsFile:void 0,a=t.clippedSegmentCount===void 0?void 0:Number(t.clippedSegmentCount),o=Number(t.segmentCount),s=Number(t.curveCount),c=$m(t.quantizationMin,4),l=$m(t.quantizationMax,4),u=$m(t.ctrlQuantizationMin,2),d=$m(t.ctrlQuantizationMax,2),f=$m(t.endpointColumnByteLengths,4);if(!n||!r||!Number.isInteger(o)||o<0||!Number.isInteger(s)||s<0||!c||!l||!u||!d||!f||f.some(e=>!Number.isInteger(e)||e<0)||i===void 0!=(a===void 0)||a!==void 0&&(!Number.isInteger(a)||a<=0||a>o))throw Error(`HEP file has an invalid strokeGeometry section.`);return{endpointsFile:n,metaFile:r,...i===void 0?{}:{clipBoundsFile:i,clippedSegmentCount:a},segmentCount:o,curveCount:s,quantizationMin:c,quantizationMax:l,ctrlQuantizationMin:u,ctrlQuantizationMax:d,endpointColumnByteLengths:f}}function Eh(e){if(typeof e!=`object`||!e)return null;let t=e,n=typeof t.positionsFile==`string`?t.positionsFile:null,r=typeof t.glyphIndexFile==`string`?t.glyphIndexFile:null,i=t.glyphIndexFormat===`u32`?`u32`:t.glyphIndexFormat===`u16`?`u16`:null,a=Number(t.count),o=$m(t.positionColumnByteLengths,3),s=typeof t.clipRectsFile==`string`?t.clipRectsFile:void 0,c=typeof t.clipReferencesFile==`string`?t.clipReferencesFile:void 0,l=t.clipRectCount===void 0?void 0:Number(t.clipRectCount);if(!n||!r||!i||!Number.isInteger(a)||a<0||!o||o.some(e=>!Number.isInteger(e)||e<0)||s===void 0!=(c===void 0)||s===void 0!=(l===void 0)||l!==void 0&&(!Number.isInteger(l)||l<0))throw Error(`HEP file has an invalid textInstances section.`);return{positionsFile:n,glyphIndexFile:r,glyphIndexFormat:i,count:a,positionColumnByteLengths:o,...s===void 0?{}:{clipRectsFile:s,clipReferencesFile:c,clipRectCount:l}}}function Dh(e){if(e===void 0)return null;let t=typeof e==`object`&&e?e:{},n=t.segmentCount,r=$m(t.quantizationMin,2),i=$m(t.quantizationMax,2);if(t.file!==`geometry/text-glyph-segments.cq16`||typeof n!=`number`||!Number.isSafeInteger(n)||n<0||!r||!i)throw Error(`HEP file has an invalid textGlyphSegments section.`);return{file:Rm,segmentCount:n,quantizationMin:r,quantizationMax:i}}async function Oh(e,t){let n=e.file(t.endpointsFile),r=e.file(t.metaFile);if(!n||!r)throw Error(`HEP file is missing v5 stroke geometry files.`);let[i,a]=await Promise.all([n.async(`uint8array`),r.async(`uint8array`)]),o;if(t.clipBoundsFile){let n=e.file(t.clipBoundsFile);if(!n)throw Error(`HEP file is missing clipped stroke bounds.`);o=new Uint8Array(await n.async(`arraybuffer`))}let s={endpointsBytes:i,metaBytes:a,clipBoundsBytes:o,manifest:t};return{...eh(s),encoded:s}}async function kh(e,t,n){let r=t.count,i=new Float32Array(r*4);if(r===0)return i;let a=e.file(t.positionsFile),o=e.file(t.glyphIndexFile);if(!a||!o)throw Error(`HEP file is missing text instance files.`);let[s,c]=await Promise.all([a.async(`arraybuffer`),o.async(`arraybuffer`)]),l=t.glyphIndexFormat===`u32`?4:2;if(c.byteLength!==r*l)throw Error(`HEP file glyph index stream has a length mismatch.`);let u=l===4?new Uint32Array(c):new Uint16Array(c);for(let e=0;e<r;e+=1)i[e*4+2]=u[e];if(n.length<r*4)throw Error(`HEP file text instance matrices are missing or incomplete.`);return Jm(new Uint8Array(s),t.positionColumnByteLengths,n,u,i,r),i}async function Ah(e,t={}){return t.signal?.throwIfAborted(),m(jh(e,t),t.signal)}async function jh(e,t){let n=t.signal,r=Xi(t.onProgress?e=>{n?.aborted||t.onProgress?.(e)}:void 0),i=await r.child(0,.16,{sourceType:`hep`}).withIndeterminateProgress(()=>_s.loadAsync(e,{signal:n}).catch(e=>{n?.throwIfAborted();let t=e instanceof Error?e.message:String(e);throw Error(`Unable to open HEP file: ${t}. A HEP file must be exported by HEPR; renaming or compressing a PDF does not create one.`,{cause:e})}),{stage:`hep-open`,sourceType:`hep`});n?.throwIfAborted();let a=i.file(`manifest.json`);if(!a)throw Error(`This is not a valid HEP file: manifest.json is missing. Compressing a PDF into a ZIP does not create a HEP file; load the PDF directly or export it from HEPR.`);if(Qh(a)===null)throw Error(`Parsed data manifest size is invalid.`);let o=await r.child(.16,.22,{sourceType:`hep`}).withIndeterminateProgress(()=>a.async(`string`),{stage:`hep-manifest`,sourceType:`hep`});n?.throwIfAborted();let s;try{s=JSON.parse(o)}catch(e){let t=e instanceof Error?e.message:String(e);throw Error(`Invalid manifest.json: ${t}`)}if(s.formatVersion!==9&&s.formatVersion!==10&&s.formatVersion!==11&&s.formatVersion!==12&&s.formatVersion!==13&&s.formatVersion!==14&&s.formatVersion!==15&&s.formatVersion!==16)throw Error(`HEP format v${String(s.formatVersion)} is not supported; expected v9–v16. Re-export the HEP file with the current version.`);if(s.sourcePdfByteLength!==void 0&&(!Number.isSafeInteger(s.sourcePdfByteLength)||Number(s.sourcePdfByteLength)<=0))throw Error(`Invalid HEP sourcePdfByteLength; expected a positive safe integer.`);let c=typeof s.scene==`object`&&s.scene?s.scene:{},l=Array.isArray(s.textures)?s.textures:[],d=Th(s.strokeGeometry),f=Eh(s.textInstances),p=Dh(s.textGlyphSegments),m=new Map,h=0,g=()=>{r.report(.22+h/27*.58,{stage:`hep-section`,sourceType:`hep`,unit:`sections`,processed:h,total:27})};for(let e of l){let t=typeof e.name==`string`?e.name:null;t&&m.set(t,e)}let v=async(e,t)=>{try{n?.throwIfAborted(),g();let r=m.get(e),a=r&&typeof r.file==`string`?r.file:null,o=a?i.file(a):null;if(!r||!o){if(t)throw Error(`HEP file is missing required texture: ${e}.`);return null}let s=await o.async(`arraybuffer`);n?.throwIfAborted();let c=yh(s,r,e),l=Z(r.logicalFloatCount,c.length);if(l>c.length)throw Error(`Texture ${e} logical float count exceeds file length.`);let u=Z(r.logicalItemCount,Math.floor(l/4));return{data:c.length===l?c:c.slice(0,l),logicalItemCount:u}}finally{h+=1,g()}},y=await v(`fill-path-meta-a`,!1),b=await v(`fill-path-meta-b`,!1),x=await v(`fill-path-meta-c`,!1),S=await v(`fill-primitives-a`,!1),C=await v(`fill-primitives-b`,!1),w=await v(`stroke-styles`,!1),E=await v(`text-instance-a`,!1),D=await v(`text-instance-c`,!1),O=await v(`text-glyph-meta-a`,!1),k=await v(`text-glyph-meta-b`,!1),A=await v(`gradient-meta-a`,!1),j=await v(`gradient-meta-b`,!1),M=await v(`gradient-meta-c`,!1),N=await v(`gradient-meta-d`,!1),P=await v(`gradient-meta-e`,!1),ee=await v(`gradient-fill-path-meta-a`,!1),F=await v(`gradient-fill-path-meta-b`,!1),te=await v(`gradient-fill-path-meta-c`,!1),ne=await v(`gradient-fill-paint-meta`,!1),re=await v(`gradient-fill-primitives-a`,!1),ae=await v(`gradient-fill-primitives-b`,!1),I=await v(`gradient-stroke-run-meta-a`,!1),oe=await v(`gradient-stroke-run-meta-b`,!1),se=await v(`gradient-stroke-endpoints`,!1),ce=await v(`gradient-stroke-primitive-meta`,!1),le=await v(`gradient-stroke-primitive-bounds`,!1),ue=await v(`gradient-stroke-styles`,!1),de=Z(c.fillPathCount,y?.logicalItemCount??0),fe=Z(c.fillSegmentCount,S?.logicalItemCount??0),pe=d?.segmentCount??0,me=f?.count??0,he=Z(c.textGlyphCount,O?.logicalItemCount??0),ge=p?.segmentCount??0;if(Z(c.textGlyphPrimitiveCount,ge)!==ge)throw Error(`HEP scene glyph segment count does not match its textGlyphSegments section.`);let _e=Z(c.gradientCount,A?.logicalItemCount??0),ve=Z(c.gradientFillPathCount,ee?.logicalItemCount??0),L=Z(c.gradientFillSegmentCount,re?.logicalItemCount??0),ye=Z(c.gradientStrokeRunCount,I?.logicalItemCount??0),be=Z(c.gradientStrokeSegmentCount,se?.logicalItemCount??0);for(let[e,t,n]of[[`gradient-meta-a`,A,_e],[`gradient-meta-b`,j,_e],[`gradient-meta-c`,M,_e],[`gradient-meta-d`,N,_e],[`gradient-meta-e`,P,_e],[`gradient-fill-path-meta-a`,ee,ve],[`gradient-fill-path-meta-b`,F,ve],[`gradient-fill-path-meta-c`,te,ve],[`gradient-fill-paint-meta`,ne,ve],[`gradient-fill-primitives-a`,re,L],[`gradient-fill-primitives-b`,ae,L],[`gradient-stroke-run-meta-a`,I,ye],[`gradient-stroke-run-meta-b`,oe,ye],[`gradient-stroke-endpoints`,se,be],[`gradient-stroke-primitive-meta`,ce,be],[`gradient-stroke-primitive-bounds`,le,be],[`gradient-stroke-styles`,ue,be]]){if(n>0&&!t)throw Error(`HEP file is missing required texture: ${e}.`);if(t&&t.logicalItemCount!==n)throw Error(`Texture ${e} item count does not match scene metadata (${t.logicalItemCount} != ${n}).`)}if(pe>0&&!w)throw Error(`HEP file is missing the stroke-styles texture.`);let xe=Q(y?.data??new Float32Array,de,`fill-path-meta-a`),Se=Q(b?.data??new Float32Array,de,`fill-path-meta-b`),Ce=Q(x?.data??new Float32Array,de,`fill-path-meta-c`),we=Q(S?.data??new Float32Array,fe,`fill-primitives-a`),Te=Q(C?.data??new Float32Array,fe,`fill-primitives-b`),Ee=Q(A?.data??new Float32Array,_e,`gradient-meta-a`),De=Q(j?.data??new Float32Array,_e,`gradient-meta-b`),Oe=Q(M?.data??new Float32Array,_e,`gradient-meta-c`),ke=Q(N?.data??new Float32Array,_e,`gradient-meta-d`),Ae=Q(P?.data??new Float32Array,_e,`gradient-meta-e`),je=Q(ee?.data??new Float32Array,ve,`gradient-fill-path-meta-a`),Me=Q(F?.data??new Float32Array,ve,`gradient-fill-path-meta-b`),Ne=Q(te?.data??new Float32Array,ve,`gradient-fill-path-meta-c`),Pe=Q(ne?.data??new Float32Array,ve,`gradient-fill-paint-meta`),Fe=Q(re?.data??new Float32Array,L,`gradient-fill-primitives-a`),Ie=Q(ae?.data??new Float32Array,L,`gradient-fill-primitives-b`),Le=Q(I?.data??new Float32Array,ye,`gradient-stroke-run-meta-a`),Re=Q(oe?.data??new Float32Array,ye,`gradient-stroke-run-meta-b`),ze=Q(se?.data??new Float32Array,be,`gradient-stroke-endpoints`),Be=Q(ce?.data??new Float32Array,be,`gradient-stroke-primitive-meta`),Ve=Q(le?.data??new Float32Array,be,`gradient-stroke-primitive-bounds`),He=Q(ue?.data??new Float32Array,be,`gradient-stroke-styles`),Ue=await Mh(i,s.gradientLut,_e),We=await Of(i,s.gradientMesh,_e,n);Ef({gradientCount:_e,gradientMetaA:Ee,...We});let Ge={gradientCount:_e,gradientMetaA:Ee,gradientMetaB:De,gradientMetaC:Oe,gradientMetaD:ke,gradientMetaE:Ae,gradientLut:Ue,gradientFillPathCount:ve,gradientFillSegmentCount:L,gradientFillPathMetaA:je,gradientFillPathMetaB:Me,gradientFillPathMetaC:Ne,gradientFillPaintMeta:Pe,gradientFillSegmentsA:Fe,gradientFillSegmentsB:Ie,gradientStrokeRunCount:ye,gradientStrokeSegmentCount:be,gradientStrokeRunMetaA:Le,gradientStrokeRunMetaB:Re,gradientStrokeEndpoints:ze,gradientStrokePrimitiveMeta:Be,gradientStrokePrimitiveBounds:Ve,gradientStrokeStyles:He},Ke=performance.now(),qe=d?await Oh(i,d):null,Je=performance.now()-Ke,Ye=qe?.endpoints??new Float32Array,Xe=Q(w?.data??new Float32Array,pe,`stroke-styles`),Ze=qe?.primitiveMeta??new Float32Array,Qe=qe?.primitiveBounds??new Float32Array,$e=Q(E?.data??new Float32Array,me,`text-instance-a`),et=performance.now(),tt=f?await kh(i,f,$e):new Float32Array,nt;if(f?.clipRectsFile&&f.clipReferencesFile){let e=i.file(f.clipRectsFile),t=i.file(f.clipReferencesFile);if(!e||!t)throw Error(`HEP file is missing text clip files.`);let[n,r]=await Promise.all([e.async(`arraybuffer`),t.async(`arraybuffer`)]);if(n.byteLength!==f.clipRectCount*16||r.byteLength!==me*4)throw Error(`HEP file text clip data has a length mismatch.`);nt=new Float32Array(n);let a=new Uint32Array(r);for(let e=0;e<a.length;e+=1){if(a[e]>f.clipRectCount)throw Error(`HEP file text clip reference is out of range.`);tt[e*4+3]=a[e]}}if(d||f){let e=performance.now()-et;console.log(`[Parsed data load] geometry decode: strokes ${Je.toFixed(0)} ms (${pe.toLocaleString()} segments), text ${e.toFixed(0)} ms (${me.toLocaleString()} instances)`)}let rt=Q(D?.data??new Float32Array,me,`text-instance-c`),it=Q(O?.data??new Float32Array,he,`text-glyph-meta-a`),at=Q(k?.data??new Float32Array,he,`text-glyph-meta-b`),{segmentsA:ot,segmentsB:st}=p?Gm(await Zh(i,p.file,n),p):{segmentsA:new Float32Array,segmentsB:new Float32Array},ct=Z(c.sourceSegmentCount,pe),lt=Z(c.mergedSegmentCount,pe),ut=Z(c.sourceTextCount,me),dt=Z(c.textInPageCount,me),ft=Z(c.textOutOfPageCount,Math.max(0,ut-dt)),pt=Math.max(1,Z(c.pageCount,1)),mt=Math.max(1,Z(c.pagesPerRow,1));Nh(Ge,pt),r.report(.82,{stage:`hep-section`,sourceType:`hep`,unit:`sections`}),n?.throwIfAborted();let ht=await Vh(i,c,s.formatVersion,n);n?.throwIfAborted();for(let e of ht)if(e.pageIndex>=pt)throw Error(`Raster layer references invalid page ${e.pageIndex}.`);r.report(.88,{stage:`compile`,sourceType:`hep`});let gt=ht[0]??null,_t=await Ch(i,s);n?.throwIfAborted();let vt=qh(c.maxHalfWidth,NaN)||Kh(Xe,pe),yt=Lh(c.bounds),bt=Lh(c.pageBounds),xt=Ih(Ih(Ph(Qe,pe),Fh(xe,Se,de)),Ih(Ph(Ve,be),Fh(je,Me,ve)))??{minX:0,minY:0,maxX:1,maxY:1},St=yt??xt,Ct=bt??St,wt=Rh(c.pageRects,Ct),Tt=zh(c.pageTextRanges,Math.max(1,Math.floor(wt.length/4)),me)??ro(wt,tt,me);r.report(.96,{stage:`compile`,sourceType:`hep`});let R=no({...We,pageRects:wt,pageTextRanges:Tt,textIndex:_t,fillPathCount:de,fillSegmentCount:fe,fillPathMetaA:xe,fillPathMetaB:Se,fillPathMetaC:Ce,fillSegmentsA:we,fillSegmentsB:Te,gradientCount:_e,gradientMetaA:Ee,gradientMetaB:De,gradientMetaC:Oe,gradientMetaD:ke,gradientMetaE:Ae,gradientLut:Ue,gradientFillPathCount:ve,gradientFillSegmentCount:L,gradientFillPathMetaA:je,gradientFillPathMetaB:Me,gradientFillPathMetaC:Ne,gradientFillPaintMeta:Pe,gradientFillSegmentsA:Fe,gradientFillSegmentsB:Ie,gradientStrokeRunCount:ye,gradientStrokeSegmentCount:be,gradientStrokeRunMetaA:Le,gradientStrokeRunMetaB:Re,gradientStrokeEndpoints:ze,gradientStrokePrimitiveMeta:Be,gradientStrokePrimitiveBounds:Ve,gradientStrokeStyles:He,segmentCount:pe,sourceSegmentCount:ct,mergedSegmentCount:lt,sourceTextCount:ut,textInstanceCount:me,textGlyphCount:he,textGlyphSegmentCount:ge,textInPageCount:dt,textOutOfPageCount:ft,textInstanceA:$e,textInstanceB:tt,textInstanceC:rt,...nt?{textClipRects:nt}:{},textGlyphMetaA:it,textGlyphMetaB:at,textGlyphSegmentsA:ot,textGlyphSegmentsB:st,rasterLayers:ht,rasterLayerWidth:gt?.width??0,rasterLayerHeight:gt?.height??0,rasterLayerData:gt?.monochrome?new Uint8Array:gt?.data??new Uint8Array,rasterLayerMatrix:gt?.matrix??new Float32Array([1,0,0,1,0,0]),endpoints:Ye,primitiveMeta:Ze,primitiveBounds:Qe,styles:Xe,bounds:St,pageBounds:Ct,pageCount:pt,pagesPerRow:mt,maxHalfWidth:vt,imagePaintOpCount:Z(c.imagePaintOpCount,0),...typeof c.imageLayerSegmentCount==`number`&&Number.isSafeInteger(c.imageLayerSegmentCount)&&c.imageLayerSegmentCount>=0&&[c.discardedTransparentCount,c.discardedDegenerateCount,c.discardedDuplicateCount,c.discardedContainedCount].every(e=>typeof e==`number`&&Number.isSafeInteger(e)&&e>=0)?{imageLayerSegmentCount:c.imageLayerSegmentCount}:{},pathCount:Z(c.pathCount,0),discardedTransparentCount:Z(c.discardedTransparentCount,0),discardedDegenerateCount:Z(c.discardedDegenerateCount,0),discardedDuplicateCount:Z(c.discardedDuplicateCount,0),discardedContainedCount:Z(c.discardedContainedCount,0)});if(gt?.monochrome&&Object.defineProperty(R,"rasterLayerData",{enumerable:!0,configurable:!0,get:()=>gt.data}),c.pagePrimitiveRanges!==void 0){let e=c.pagePrimitiveRanges;if(!Array.isArray(e)||e.length!==R.pageRects.length/4*12||!e.every(e=>Number.isSafeInteger(e)&&e>=0&&e<=4294967295))throw RangeError(`Invalid page primitive ranges.`);R.pagePrimitiveRanges=Uint32Array.from(e),Wi(R)}if(c.clipPaths!==void 0){let e=Jh(c.clipPaths,af,`clip paths`),t=Yh(e,`count`,`clip paths`),r=Yh(e,`edgeCount`,`clip paths`);if(R.clipPaths=hf(await Zh(i,af,n)),R.clipPaths.length!==t||R.clipPaths.reduce((e,t)=>e+t.edges.length/4,0)!==r)throw Error(`Scene clip paths do not match their manifest entry.`)}if(c.drawRuns!==void 0){let e=Jh(c.drawRuns,of,`draw runs`),t=Yh(e,`count`,`draw runs`),r=Xh(e,`grouped-v1`,s.formatVersion,`draw runs`);if(R.drawRuns=_f(await Zh(i,of,n),r),R.drawRuns.length!==t)throw Error(`Scene draw runs do not match their manifest entry.`)}if(c.optionalContent!==void 0&&(_(c.optionalContent),R.optionalContent=c.optionalContent),c.retainedPages!==void 0){if(!Array.isArray(c.retainedPages))throw Error(`Invalid retained page resources.`);let e=new Map;R.retainedPages=[];for(let t of c.retainedPages){if(n?.throwIfAborted(),!t||typeof t.file!=`string`||!t.file||!Array.isArray(t.matrix)||t.matrix.length!==6||!t.matrix.every(e=>typeof e==`number`&&Number.isFinite(e))||!Array.isArray(t.optionalContentConditions)||!t.optionalContentConditions.every(e=>typeof e==`number`&&Number.isSafeInteger(e)&&e>=-1&&e<=2147483647))throw Error(`Invalid retained page resource metadata.`);let r=e.get(t.file);if(!r){let a=i.file(t.file);if(!a)throw Error(`Missing retained page resource.`);r=rf(await a.async(`uint8array`),n),e.set(t.file,r)}R.retainedPages.push({page:r,matrix:Float32Array.from(t.matrix),optionalContentConditions:Int32Array.from(t.optionalContentConditions)})}}if(c.paintGraph!==void 0){let e=Jh(c.paintGraph,sf,`paint graph`),t=Yh(e,`rootCount`,`paint graph`),r=Xh(e,`group-runs-v1`,s.formatVersion,`paint graph`);if(R.paintGraph=Cf(await Zh(i,sf,n),r?R.drawRuns?.length??0:void 0),R.paintGraph.roots.length!==t)throw Error(`Scene paint graph does not match its manifest entry.`)}return T(R),u(R),Yd(R),ie(R),qe&&ch.set(R,qe.encoded),R.annotations=await vd(i,c.annotations,R,n),await Sd(i,c.structure,R,n),lh.add(R),s.sourcePdfByteLength!==void 0&&(R.sourcePdfByteLength=Number(s.sourcePdfByteLength)),await od(i,R,s.lod,n),r.complete({sourceType:`hep`}),R}async function Mh(e,t,n){let r=n*Aa*4;if(r===0)return new Uint8Array;if(!t||typeof t!=`object`)throw Error(`HEP file is missing its gradient LUT metadata.`);let i=t,a=Z(i.width,0),o=Z(i.height,0),s=Z(i.byteLength,0),c=typeof i.file==`string`?i.file:``;if(a!==1024||o!==n||s!==r)throw Error(`Parsed data gradient LUT dimensions do not match the scene metadata.`);let l=c?e.file(c):null;if(!l)throw Error(`HEP file is missing its gradient LUT payload.`);let u=new Uint8Array(await l.async(`arraybuffer`));if(u.length!==r)throw Error(`Gradient LUT byte length is invalid (${u.length} != ${r}).`);return u}function Nh(e,t){let{gradientCount:n,gradientMetaA:r,gradientMetaB:i,gradientMetaC:a,gradientMetaD:o,gradientMetaE:s,gradientLut:c,gradientFillPathCount:l,gradientFillSegmentCount:u,gradientFillPathMetaA:d,gradientFillPaintMeta:f,gradientStrokeRunCount:p,gradientStrokeSegmentCount:m,gradientStrokeRunMetaA:h,gradientStrokeRunMetaB:g}=e;for(let[t,n]of[[`gradient metadata A`,e.gradientMetaA],[`gradient metadata B`,e.gradientMetaB],[`gradient metadata C`,e.gradientMetaC],[`gradient metadata D`,e.gradientMetaD],[`gradient metadata E`,e.gradientMetaE],[`gradient fill metadata A`,e.gradientFillPathMetaA],[`gradient fill metadata B`,e.gradientFillPathMetaB],[`gradient fill metadata C`,e.gradientFillPathMetaC],[`gradient fill paint metadata`,e.gradientFillPaintMeta],[`gradient fill primitives A`,e.gradientFillSegmentsA],[`gradient fill primitives B`,e.gradientFillSegmentsB],[`gradient stroke run metadata A`,e.gradientStrokeRunMetaA],[`gradient stroke run metadata B`,e.gradientStrokeRunMetaB],[`gradient stroke endpoints`,e.gradientStrokeEndpoints],[`gradient stroke primitive metadata`,e.gradientStrokePrimitiveMeta],[`gradient stroke primitive bounds`,e.gradientStrokePrimitiveBounds],[`gradient stroke styles`,e.gradientStrokeStyles]])if(!n.every(Number.isFinite))throw Error(`Parsed data ${t} contains non-finite values.`);if(c.length!==n*1024*4)throw Error(`Gradient LUT length does not match gradientCount.`);for(let e=0;e<n;e+=1){let t=e*4,n=r[t],c=r[t+1];if(n!==0&&n!==1&&n!==2||c!==0&&c!==1)throw Error(`Gradient ${e} has an invalid kind or bounding-box flag.`);let l=r[t+2],u=r[t+3];if(!Number.isInteger(l)||l<0||l>3||!Number.isInteger(u)||u<0||u>16777216)throw Error(`Gradient ${e} has invalid extension or background metadata.`);if(![...i.subarray(t,t+4),...a.subarray(t,t+4),...o.subarray(t,t+4)].every(Number.isFinite))throw Error(`Gradient ${e} contains non-finite metadata.`);let d=i[t]*i[t+3]-i[t+1]*i[t+2];if(Math.abs(d)<=1e-12)throw Error(`Gradient ${e} has a singular scene-to-gradient transform.`);let f=o[t]-a[t+2],p=o[t+1]-a[t+3];if(n===0&&f*f+p*p<=1e-18)throw Error(`Axial gradient ${e} has a degenerate axis.`);if(n===1){let n=o[t+2],r=o[t+3];if(n<0||r<0)throw Error(`Radial gradient ${e} has a negative radius.`);if(Math.hypot(f,p)<=1e-9&&Math.abs(r-n)<=1e-9)throw Error(`Radial gradient ${e} has identical start and end circles.`)}if(c===1){let n=s.subarray(t,t+4);if(!n.every(Number.isFinite)||n[2]<n[0]||n[3]<n[1])throw Error(`Gradient ${e} has an invalid bounding box.`)}}let _=(e,t)=>{if(!Number.isInteger(e)||e<-1||e>=n)throw Error(`${t} references invalid gradient ${e}.`)};for(let e=0;e<l;e+=1){let n=e*4,r=d[n],i=d[n+1];if(!Number.isInteger(r)||!Number.isInteger(i)||r<0||i<=0||r+i>u)throw Error(`Gradient fill ${e} has an invalid primitive range.`);if(_(f[n],`Gradient fill ${e}`),_(f[n+1],`Gradient fill mask ${e}`),!Number.isFinite(f[n+2])||f[n+2]<0||!Number.isInteger(f[n+3])||f[n+3]<0||f[n+3]>=t)throw Error(`Gradient fill ${e} has invalid paint metadata.`)}for(let e=0;e<p;e+=1){let n=e*4,r=h[n],i=h[n+1];if(!Number.isInteger(r)||!Number.isInteger(i)||r<0||i<=0||r+i>m)throw Error(`Gradient stroke run ${e} has an invalid segment range.`);if(_(h[n+2],`Gradient stroke run ${e}`),_(h[n+3],`Gradient stroke mask ${e}`),!Number.isFinite(g[n])||g[n]<0||!Number.isInteger(g[n+1])||g[n+1]<0||g[n+1]>=t)throw Error(`Gradient stroke run ${e} has invalid paint metadata.`)}}function Q(e,t,n){let r=t*4;if(r===0)return new Float32Array;if(e.length<r)throw Error(`Texture ${n} has insufficient data (${e.length} < ${r}).`);return e.length===r?e:e.slice(0,r)}function Ph(e,t){if(t<=0||e.length<t*4)return null;let n=1/0,r=1/0,i=-1/0,a=-1/0;for(let o=0;o<t;o+=1){let t=o*4;n=Math.min(n,e[t]),r=Math.min(r,e[t+1]),i=Math.max(i,e[t+2]),a=Math.max(a,e[t+3])}return{minX:n,minY:r,maxX:i,maxY:a}}function Fh(e,t,n){if(n<=0||e.length<n*4||t.length<n*4)return null;let r=1/0,i=1/0,a=-1/0,o=-1/0;for(let s=0;s<n;s+=1){let n=s*4;r=Math.min(r,e[n+2]),i=Math.min(i,e[n+3]),a=Math.max(a,t[n]),o=Math.max(o,t[n+1])}return{minX:r,minY:i,maxX:a,maxY:o}}function Ih(e,t){return!e&&!t?null:e?t?{minX:Math.min(e.minX,t.minX),minY:Math.min(e.minY,t.minY),maxX:Math.max(e.maxX,t.maxX),maxY:Math.max(e.maxY,t.maxY)}:{...e}:t?{...t}:null}function Lh(e){if(!e||typeof e!=`object`)return null;let t=e,n=qh(t.minX,NaN),r=qh(t.minY,NaN),i=qh(t.maxX,NaN),a=qh(t.maxY,NaN);return[n,r,i,a].every(Number.isFinite)?{minX:n,minY:r,maxX:i,maxY:a}:null}function Rh(e,t){if(Array.isArray(e)){let t=Math.floor(e.length/4);if(t>0){let n=new Float32Array(t*4),r=0;for(let i=0;i<t;i+=1){let t=i*4,a=Number(e[t]),o=Number(e[t+1]),s=Number(e[t+2]),c=Number(e[t+3]);[a,o,s,c].every(Number.isFinite)&&(n[r]=a,n[r+1]=o,n[r+2]=s,n[r+3]=c,r+=4)}if(r>0)return n.slice(0,r)}}return new Float32Array([t.minX,t.minY,t.maxX,t.maxY])}function zh(e,t,n){if(!Array.isArray(e))return null;let r=Math.max(1,t|0);if(e.length<r*2)return null;let i=Math.max(0,n|0),a=new Uint32Array(r*2),o=0;for(let t=0;t<r;t+=1){let n=t*2,r=Z(e[n],o),s=Z(e[n+1],0),c=Math.min(Math.max(r,o),i),l=Math.min(s,Math.max(0,i-c));a[n]=c,a[n+1]=l,o=c+l}return a}var Bh=80;async function Vh(e,t,n,r){if(t.rasterLayers===void 0)return[];let i=Jh(t.rasterLayers,hm,`raster layers`),a=Yh(i,`count`,`raster layers`),o=Yh(i,`atlasCount`,`raster layers`),s=i.interpolation;if(s!==void 0&&(typeof s!=`string`||s.length!==a||/[^01-]/.test(s)))throw Error(`Scene raster layer interpolation does not match its layers.`);let c=e.file(hm),l=c?Qh(c):null;if(l===null||l>(a+o+1)*Bh)throw Error(`Scene raster layer table is missing or larger than its records allow.`);let u=Lm(await Zh(e,hm,r),{maxLayers:a,maxAtlases:o,maxDimension:2147483647});if(u.layers.length!==a||u.atlases.length!==o)throw Error(`Scene raster layers do not match their manifest entry.`);if(n<10&&u.layers.some(e=>e.storage===`mono`))throw Error(`Packed monochrome raster layers require HEP scene format v10.`);if(n<11&&u.layers.some(e=>e.storage===`jbig2`))throw Error(`Original JBIG2 raster layers require HEP scene format v11.`);if(n<12&&u.layers.some(e=>e.storage===`binary`))throw Error(`Transposed binary raster layers require HEP scene format v12.`);if(n<15&&u.layers.some(e=>e.source!==void 0))throw Error(`Shared raster layer sections require HEP scene format v15.`);if(n<16&&u.layers.some(e=>e.storage===`jpx`))throw Error(`Original JPEG 2000 raster layers require HEP scene format v16.`);Gh(e,u);let d=await Uh(e,i.repeats,a,n,r),f=new Map;u.layers.forEach((e,t)=>{e.cell&&f.set(e.cell.atlas,t)});let p=new Map,m=new Map,h=new Map,g=[];for(let t=0;t<u.layers.length;t+=1){r?.throwIfAborted();let n=u.layers[t];if(n.source!==void 0){let e=g[n.source],r=e.monochrome?{monochrome:e.monochrome}:{data:e.data};g.push(Hh(e,n,r,d?.get(t),typeof s==`string`?s[t]:`-`));continue}let i={width:n.width,height:n.height,matrix:n.matrix,paintOrder:n.paintOrder,pageIndex:n.pageIndex,...d?.has(t)?{repeat:d.get(t)}:{},...typeof s==`string`&&s[t]!==`-`?{interpolate:s[t]===`1`}:{},...n.opacity===void 0?{}:{opacity:n.opacity}};if(n.storage===`mono`){let a=await e.file(Dm(t,`mono`)).async(`uint8array`);r?.throwIfAborted(),g.push(de(i,vp(a,n.width,n.height)));continue}if(n.storage===`binary`){let a=await e.file(Dm(t,`binary`)).async(`uint8array`);r?.throwIfAborted(),g.push(de(i,Ep(a,n.width,n.height,r)));continue}if(n.storage===`jbig2`){let a=await e.file(Dm(t,`jbig2`)).async(`uint8array`);r?.throwIfAborted();let o=Pp(a,n.width,n.height,Dp),s=new Uint8Array;if(o.globalsIndex!==4294967295){let t=Np(o.globalsIndex),n=e.file(t);if(!n||Qh(n)!==o.globalsLength)throw Error(`JBIG2 globals section ${t} is missing or does not match its metadata.`);let i=h.get(o.globalsIndex);i?s=i:(s=await n.async(`uint8array`),r?.throwIfAborted(),h.set(o.globalsIndex,s))}let c=await Fp(a,s,n.width,n.height,Dp,r);r?.throwIfAborted(),g.push(de(i,c));continue}if(n.storage===`jpx`){let a=await e.file(Dm(t,`jpx`)).async(`uint8array`);r?.throwIfAborted();let o=await nm(a,n.width,n.height,r);r?.throwIfAborted(),g.push({...i,...o});continue}let a;if(n.storage===`atlas`){let i=n.cell,o=u.atlases[i.atlas],s=`${i.atlas}:${i.x}:${i.y}:${n.width}:${n.height}`,c=m.get(s);if(c)a=c;else{let t=p.get(i.atlas);t||(t=await Wh(e,Om(i.atlas,o.encoding),o.width,o.height),r?.throwIfAborted(),p.set(i.atlas,t)),a=new Uint8Array(n.width*n.height*4),Pm(t,o.width,i.x,i.y,a,n.width,0,0,n.width,n.height),m.set(s,a)}f.get(i.atlas)===t&&p.delete(i.atlas)}else a=await Wh(e,Dm(t,n.storage),n.width,n.height),r?.throwIfAborted();g.push({...i,data:a})}return g}function Hh(e,t,n,r,i){let a={width:e.width,height:e.height,matrix:t.matrix,paintOrder:t.paintOrder,pageIndex:t.pageIndex,...r?{repeat:r}:{},...i!==`-`&&i!==void 0?{interpolate:i===`1`}:{},...t.opacity===void 0?{}:{opacity:t.opacity},...e.sourceJpx?{sourceJpx:e.sourceJpx}:{}};return`monochrome`in n?de(a,n.monochrome):{...a,data:n.data}}async function Uh(e,t,n,r,i){if(t===void 0)return;if(r<14)throw Error(`Raster repeats require HEP scene format v14.`);let a=Jh(t,rm,`raster repeats`),o=Yh(a,`count`,`raster repeats`),s=Yh(a,`translationCount`,`raster repeats`);if(o>n)throw Error(`Scene raster repeat count exceeds its layers.`);let c=e.file(rm);if(!c||Qh(c)!==am(o,s))throw Error(`Scene raster repeats are missing or do not match their declared byte length.`);return sm(await Zh(e,rm,i),n,o,s,i)}async function Wh(e,t,n,r){let i=e.file(t);if(!i)throw Error(`HEP file is missing raster section ${t}.`);let a=new Uint8Array(await i.async(`arraybuffer`)),o=n*r*4,s=Qf(t);if(!s){if(a.byteLength!==o)throw Error(`Raster section ${t} size does not match its metadata (${a.byteLength} !== ${o}).`);return a}let c=Yf(s,a);if(!c||c.width!==n||c.height!==r)throw Error(`Raster image ${t} header dimensions do not match its metadata.`);let l=await qf(s,a);if(!l)throw Error(`Unable to decode raster image ${t}; the image is invalid or no compatible image decoder is available.`);if(l.width!==n||l.height!==r||l.data.byteLength!==o)throw Error(`Raster image ${t} dimensions do not match its metadata.`);return l.data}function Gh(e,t){let n=(e,t,n=e*4)=>{if(!Number.isSafeInteger(e)||!Number.isSafeInteger(n))throw Error(`${t} decoded byte length is not a safe integer.`)},r=(t,n,r)=>{let i=e.file(t);if(!i)throw Error(`HEP file is missing ${r.toLowerCase()}: ${t}.`);let a=Qh(i);if(a===null)throw Error(`${r} HEP section size is invalid.`);if(n!==null&&Qf(t)===null&&a!==n)throw Error(`${r} raw byte length does not match its metadata.`);return a};t.atlases.forEach((e,t)=>{let i=e.width*e.height;n(i,`Raster atlas ${t}`),r(Om(t,e.encoding),i*4,`Raster atlas ${t}`)}),t.layers.forEach((e,t)=>{let i=e.width*e.height,a=e.storage===`mono`||e.storage===`binary`||e.storage===`jbig2`?gp(e.width,e.height):i*4;if(n(i,`Raster layer ${t}`,a),e.storage!==`atlas`&&e.source===void 0){let n=e.storage===`binary`||e.storage===`jbig2`||e.storage===`jpx`,i=r(Dm(t,e.storage),n?null:a,`Raster layer ${t}`);if(e.storage===`binary`&&(i<18||i>Cp(e.width,e.height)))throw Error(`Raster layer ${t} binary section size does not match its dimensions.`);if(e.storage===`jbig2`&&(i<=40||i>Dp||a-8+i-40>Dp))throw Error(`Raster layer ${t} JBIG2 section exceeds the decode byte budget.`);if(e.storage===`jpx`&&(i<=32||!Number.isSafeInteger(a+i)))throw Error(`Raster layer ${t} JPEG 2000 section size is invalid.`)}});for(let t of Object.keys(e.files)){if(!/^raster\/jbig2-globals-\d+\.bin$/.test(t))continue;let e=r(t,null,`JBIG2 globals`);if(e===0||e>Dp)throw Error(`JBIG2 globals section exceeds the decode byte budget.`)}}function Kh(e,t){let n=0;for(let r=0;r<t;r+=1)n=Math.max(n,e[r*4]);return n}function qh(e,t){let n=Number(e);return Number.isFinite(n)?n:t}function Jh(e,t,n){if(!e||typeof e!=`object`||Array.isArray(e))throw Error(`Invalid scene ${n} entry.`);let r=e;if(r.file!==t)throw Error(`Scene ${n} entry does not name ${t}.`);return r}function Yh(e,t,n){let r=e[t];if(typeof r!=`number`||!Number.isSafeInteger(r)||r<0)throw Error(`Invalid scene ${n} ${t}.`);return r}function Xh(e,t,n,r){if(e.encoding===void 0)return!1;if(e.encoding!==t)throw Error(`Unsupported scene ${r} encoding.`);if(n<13)throw Error(`Scene ${r} encoding requires HEP v13.`);return!0}async function Zh(e,t,n){n?.throwIfAborted();let r=e.file(t);if(!r)throw Error(`Missing scene section ${t}.`);let i=await r.async(`uint8array`);return n?.throwIfAborted(),i}function Qh(e){let t=e.uncompressedSize;return typeof t==`number`&&Number.isSafeInteger(t)&&t>=0?t:null}var $h=Uint8Array.of(0,0,0,0);function eg(e,t){let n=Object.defineProperties({},Object.getOwnPropertyDescriptors(e));return n.drawRuns=(e.drawRuns??x(e)).map(e=>({...e,pdfRepresentation:{pageIndex:0,detail:t}})),n.paintGraph=e.paintGraph??{roots:n.drawRuns.map((e,t)=>({kind:`draw`,runIndex:t}))},n}function tg(e){let t=eg(e,!1);return t.rasterLayers=[...e.rasterLayers,{pageDemandSlot:!0,width:1,height:1,data:$h,opacity:0,matrix:Float32Array.of(e.pageRects[2]-e.pageRects[0],0,0,e.pageRects[3]-e.pageRects[1],e.pageRects[0],e.pageRects[1]),pageIndex:0,paintOrder:0}],t.drawRuns.push({kind:`raster`,first:e.rasterLayers.length,count:1,pdfRepresentation:{pageIndex:0,detail:!0}}),t.paintGraph={roots:[...t.paintGraph.roots,{kind:`draw`,runIndex:t.drawRuns.length-1}]},t.pagePrimitiveRanges=Uint32Array.from(Vi.flatMap(e=>[0,Ui(t)[e]])),t}function ng(e){return e.rasterLayers.length!==1||e.segmentCount>0||e.fillPathCount>0||e.textInstanceCount>0||e.gradientFillPathCount>0||e.gradientStrokeRunCount>0||!!e.clipPaths?.length||!!e.optionalContent}function rg(e,t){if(yc(t)||t.retainedPages?.length)return null;let n=eg(t,!0);n.rasterLayers=t.rasterLayers.map(e=>({pageDemandSlot:!0,width:1,height:1,data:$h,opacity:0,matrix:e.matrix,...e.repeat?{repeat:e.repeat}:{},paintOrder:e.paintOrder,pageIndex:0}));let r=Qa([eg(e,!1),n]);r.pageCount=r.pagesPerRow=1,r.pageRects=e.pageRects,r.pageTextRanges=Uint32Array.of(0,r.textInstanceCount),r.pagePrimitiveRanges=Uint32Array.from(Vi.flatMap(e=>[0,Ui(r)[e]])),r.textIndex=e.textIndex,r.textContent=e.textContent,r.pdfPages=e.pdfPages,r.annotations=r.annotations?.map(e=>({...e,pageIndex:0})),r.bounds=r.pageBounds=e.pageBounds;for(let e of r.rasterLayers)e.pageIndex=0;for(let e of r.drawRuns??[])e.pdfRepresentation&&(e.pdfRepresentation.pageIndex=0);for(let e=3;e<r.gradientFillPaintMeta.length;e+=4)r.gradientFillPaintMeta[e]=0;for(let e=1;e<r.gradientStrokeRunMetaB.length;e+=4)r.gradientStrokeRunMetaB[e]=0;return r}function ig(e,t,n,r){let i=e.matrix.slice(),a=t.pageRects[r*4]-n.pageRects[0],o=t.pageRects[r*4+1]-n.pageRects[1];return i[4]+=a,i[5]+=o,ge(e,{matrix:i,...e.repeat?{repeat:M(e.repeat,a,o)}:{},pageIndex:r,pageDemandSlot:!0})}function ag(e){if(e===`bc7`)return{blockWidth:4,blockHeight:4,bytesPerBlock:16,webGpuFormat:`bc7-rgba-unorm`};if(e===`astc-4x4`)return{blockWidth:4,blockHeight:4,bytesPerBlock:16,webGpuFormat:`astc-4x4-unorm`};throw RangeError(`Unsupported raster compression format: ${String(e)}.`)}function og(e){return e.bc7?`bc7`:e.astc4x4?`astc-4x4`:null}function sg(e,t,n,r={}){fg(e,t);let{blockWidth:i,blockHeight:a,bytesPerBlock:o}=ag(n),s=r.padBase===!1?e:Math.ceil(e/i)*i,c=r.padBase===!1?t:Math.ceil(t/a)*a;fg(s,c);let l=Math.floor(Math.log2(Math.max(s,c)))+1,u=r.mipmaps===!1?1:r.mipLevelCount??l;if(!Number.isInteger(u)||u<1||u>l)throw RangeError(`Invalid compressed mip level count.`);let d=[],f=0;for(let e=0;e<u;e++){let e=Math.ceil(s/i),t=Math.ceil(c/a),n=e*t*o;d.push({width:s,height:c,blocksX:e,blocksY:t,byteOffset:f,byteLength:n}),f+=n,s=Math.max(1,Math.floor(s/2)),c=Math.max(1,Math.floor(c/2))}return d}function cg(e,t,n,r=!0,i=!0,a){return sg(e,t,n,{mipmaps:r,padBase:i,mipLevelCount:a}).reduce((e,t)=>e+t.byteLength,0)}function*lg(e,t,n,r){if(I(r),fg(t,n),!(e instanceof Uint8Array)||e.length<t*n*4)throw RangeError(`Insufficient compression source pixels.`);let i=Math.ceil(t/4)*4,a=Math.ceil(n/4)*4;fg(i,a);let o=e;if(i!==t||a!==n){o=new Uint8Array(i*a*4);for(let s=0;s<a;s++){s&63||I(r);let a=Math.min(n-1,s),c=e.subarray(a*t*4,(a+1)*t*4);o.set(c,s*i*4);let l=c.subarray((t-1)*4);for(let e=t;e<i;e++)o.set(l,(s*i+e)*4)}}for(yield{width:i,height:a,data:o};i>1||a>1;){I(r);let e=Math.max(1,Math.floor(i/2)),t=Math.max(1,Math.floor(a/2)),n=new Uint8Array(e*t*4);for(let s=0;s<t;s++){s&63||I(r);let t=Math.min(a-1,s*2),c=Math.min(a-1,t+1);for(let r=0;r<e;r++){let a=Math.min(i-1,r*2),l=Math.min(i-1,a+1);for(let u=0;u<4;u++)n[(s*e+r)*4+u]=o[(t*i+a)*4+u]+o[(t*i+l)*4+u]+o[(c*i+a)*4+u]+o[(c*i+l)*4+u]+2>>2}}o=n,i=e,a=t,yield{width:i,height:a,data:o}}}function ug(e){let t=(e,t=!1,n=0,r=0,i=0)=>({eligible:e===`smooth-color`||e===`scan`,reason:e,opaque:t,sampledPixels:n,edgeFraction:r,maxGradient:i});if(e.monochrome)return t(`monochrome`);if(e.imageMask||e.stencilMask)return t(`mask`);if(e.exactPixels)return t(`exact-pixels`);if(e.containsText)return t(`text`);let{width:n,height:r}=e;if(!dg(n,r))return t(`invalid-pixels`);if(n*r<4096)return t(`small-image`);if(Math.min(n,r)<16)return t(`thin-image`);let i=e.data;if(!(i instanceof Uint8Array)||i.length<n*r*4)return t(`invalid-pixels`);let a=-1,o=-1,s=!1;for(let e=0;e<n*r*4;e+=4){if(i[e+3]!==255)return t(`alpha`);if(!s){let t=i[e]|i[e+1]<<8|i[e+2]<<16;a<0?a=t:t!==a&&t!==o&&(o<0?o=t:s=!0)}}if(!s)return t(`binary`,!0);let c=Math.ceil(n/4),l=Math.ceil(r/4),u=Math.min(64,c),d=Math.min(l,Math.floor(4096/u)),f=0,p=0,m=0,h=0,g=(e,t)=>{let n=Math.max(Math.abs(i[e]-i[t]),Math.abs(i[e+1]-i[t+1]),Math.abs(i[e+2]-i[t+2]));p++,n>=24&&m++,h=Math.max(h,n)};for(let e=0;e<d;e++){let t=(d===1?0:Math.floor(e*(l-1)/(d-1)))*4;for(let e=0;e<u;e++){let i=(u===1?0:Math.floor(e*(c-1)/(u-1)))*4;for(let e=t;e<Math.min(r,t+4);e++)for(let t=i;t<Math.min(n,i+4);t++){let i=(e*n+t)*4;f++,t+1<n&&g(i,i+4),e+1<r&&g(i,i+n*4)}}}let _=p?m/p:0;return t(h>=64||_>.025?e.compressionHint===`scan`?`scan`:`detailed-content`:`smooth-color`,!0,f,_,h)}function dg(e,t){return Number.isSafeInteger(e)&&e>0&&Number.isSafeInteger(t)&&t>0&&Number.isSafeInteger(e*t*4)}function fg(e,t){if(!dg(e,t))throw RangeError(`Invalid raster compression dimensions.`)}var pg=1048576,mg=1024*pg,hg=16*pg,gg=256*pg,_g=64*pg,vg=new WeakMap;function yg(e,t,n){let r=e.monochrome?.data;if(!r||typeof r!=`object`||!Number.isSafeInteger(n)||n<=0)return;let i=vg.get(r)??new Map,a=bg(e,t);!i.has(a)&&i.size>=8&&i.delete(i.keys().next().value),i.set(a,n),vg.set(r,i)}function bg(e,t){return`${e.width}:${e.height}:${t.width}:${t.height}:`+t.tiles.map(e=>`${e.x},${e.y},${e.width},${e.height}`).join(`;`)}function xg(e,t,n){let r=Tg(e,t,n),i=e.monochrome?.data;if(!i||typeof i!=`object`||!e.reducedMonochrome&&Fe(e,t))return r;let a=vg.get(i)?.get(bg(e,t));return a===void 0?r:Math.min(r,a)}function Sg(){let e=null;try{let t=globalThis.navigator?.deviceMemory;typeof t==`number`&&Number.isFinite(t)&&t>0&&(e=t)}catch{}let t=e===null?_g:Math.floor(Math.max(hg,Math.min(gg,e*mg/32)));return{bytes:t,peakBytes:t*2,deviceMemoryGiB:e,source:e===null?`fallback`:`device-memory`}}function Cg(e,t,n,r,i=!1){if(Og(e,t),!n&&r)return cg(e,t,r);if(n||i){let r=he(e,t);return(n?Math.ceil(e/8)*t:e*t)+r.width*r.height}let a=e,o=t,s=a*o*4;for(;a>1||o>1;)a=Math.max(1,Math.floor(a/2)),o=Math.max(1,Math.floor(o/2)),s+=a*o*4;return s}function wg(e,t,n,r=!1){return e.tiles.reduce((e,i)=>e+Cg(i.width,i.height,t,n,r),0)}function Tg(e,t,n){let r=!!e.monochrome&&!Fe(e,t);return wg(t,r,n,!!e.monochrome&&!!e.reducedMonochrome&&!r)}function Eg(e){let t=new Map;return(n,r)=>{let i=t.get(n);i||t.set(n,i=new Map);let a=i.get(r);return a||(a=Ne(n,r,e),i.set(r,a)),a}}function Dg(e,t,n,r){let i=Sg(),a=n===void 0||!Number.isFinite(n)?i.bytes:Math.max(0,Math.min(i.bytes,Math.floor(n))),o=Eg(t),s=e.map(e=>{Og(e.width,e.height);let t=e.displayWidth===void 0?e.width:Math.max(1,Math.min(e.width,Math.floor(e.displayWidth))),n=e.displayHeight===void 0?e.height:Math.max(1,Math.min(e.height,Math.floor(e.displayHeight)));return Og(t,n),o(t,n)}),c=e.map((e,t)=>!!e.monochrome&&e.displayWidth===void 0&&!Fe(e,s[t])),l=e.map(e=>Number.isFinite(e.allocationCopies)&&e.allocationCopies>=1?Math.ceil(e.allocationCopies):1),u=s.map((t,n)=>xg(e[n],t)*l[n]),d=u.reduce((e,t)=>e+t,0),f=u.reduce((e,t,n)=>e+(c[n]?t:0),0),p=(e,t,n,r)=>({plans:e,compressionFormats:r,budget:i,availableBytes:a,unscaledBytes:d,estimatedBytes:t,protectedBytes:f,resolutionScale:n,overBudget:t>a});if(d<=a&&!e.some(e=>e.preferCompression)||c.every(Boolean))return p(s,d,1,e.map(()=>null));let m=t=>{let n=t.map((t,n)=>!r||c[n]||e[n].monochrome||!e[n].compressionEligible||d<=a&&!e[n].preferCompression?null:wg(t,!1,r)<wg(t,!1)?r:null);return{plans:t,bytes:t.reduce((t,r,i)=>t+(c[i]?u[i]:xg(e[i],r,n[i])*l[i]),0),compressionFormats:n}},h=m(s);if(h.bytes<=a)return p(s,h.bytes,1,h.compressionFormats);let g=e=>{let n=Eg(t),r=s.map((t,r)=>c[r]?t:n(Math.max(1,Math.floor(t.width*e)),Math.max(1,Math.floor(t.height*e))));return m(r)},_=0,v=1,y=g(0);if(y.bytes>a)return p(y.plans,y.bytes,0,y.compressionFormats);for(let e=0;e<32;e++){let e=(_+v)/2,t=g(e);t.bytes<=a?(_=e,y=t):v=e}return p(y.plans,y.bytes,_,y.compressionFormats)}function Og(e,t){if(!Number.isSafeInteger(e)||e<1||!Number.isSafeInteger(t)||t<1||!Number.isSafeInteger(e*t*4))throw RangeError(`Raster memory estimates require positive integer dimensions with a safe byte count.`)}var kg=new WeakMap,Ag=new Set;function jg(e,t){let n=e.compressionFormats.filter(Boolean).length;if(e.resolutionScale>=1&&!e.overBudget&&!n)return;let r=`${e.budget.bytes}:${e.availableBytes}:${e.unscaledBytes}:${e.estimatedBytes}:${e.protectedBytes}:${e.compressionFormats.join(`,`)}`;if(t?kg.get(t)===r:Ag.has(r))return;t?kg.set(t,r):Ag.add(r);let i=e.budget.deviceMemoryGiB===null?`a conservative fallback`:`${e.budget.deviceMemoryGiB} GiB of reported device RAM`;console.warn(`[HEPR] Raster GPU demand is estimated at ${Math.ceil(e.unscaledBytes/pg)} MiB; the automatic resident raster target is ${Math.ceil(e.availableBytes/pg)} MiB, estimated from ${i}, not measured VRAM. `+(n?`Using ${e.compressionFormats.find(Boolean)} GPU compression for ${n} eligible raster(s). `:``)+(e.resolutionScale<1?`Drawing rasters at reduced resolution (${Math.ceil(e.estimatedBytes/pg)} MiB estimated). `:``)+(e.overBudget?`Keeping lossless packed rasters and minimum textures even though they exceed this heuristic target.`:``))}var Mg=Le({buildRasterScenePreview:()=>Ng,sceneCpuBytes:()=>Pg});function Ng(e,t){let n=e.rasterLayers.map(e=>{let n=Math.min(1,t/Math.max(e.width,e.height)),r=Math.max(1,Math.floor(e.width*n)),i=Math.max(1,Math.floor(e.height*n)),a=Ne(r,i,t),o;if(e.monochrome){let t=_e(e.monochrome,e.width,e.height,a)[0],n=e.monochrome.colors;o=new Uint8Array(r*i*4);for(let e=0;e<t.length;e++){let r=t[e]/255,i=n[3]*(1-r),a=n[7]*r,s=i+a;for(let t=0;t<3;t++)o[e*4+t]=s>0?Math.round((n[t]*i+n[t+4]*a)/s):0;o[e*4+3]=Math.round(s)}}else{o=Pe(e,a)[0];for(let e=0;e<o.length;e+=4){let t=o[e+3];if(t>0&&t<255)for(let n=0;n<3;n++)o[e+n]=Math.min(255,Math.round(o[e+n]*255/t))}}let s=Object.getOwnPropertyDescriptors(e);return delete s.monochrome,s.width={enumerable:!0,configurable:!0,writable:!0,value:r},s.height={enumerable:!0,configurable:!0,writable:!0,value:i},s.data={enumerable:!0,configurable:!0,writable:!0,value:o},Object.defineProperties({},s)}),r=Object.getOwnPropertyDescriptors(e),i={rasterLayers:n,rasterLayerWidth:n[0]?.width??0,rasterLayerHeight:n[0]?.height??0,rasterLayerData:n[0]?.data??new Uint8Array};for(let[e,t]of Object.entries(i))r[e]={enumerable:!0,configurable:!0,writable:!0,value:t};return Object.defineProperties({},r)}function Pg(e){let t=new Set,n=new Set,r=0,i=e=>{if(typeof e==`string`){r+=e.length*2;return}if(typeof e==`object`&&e&&!n.has(e)){if(n.add(e),ArrayBuffer.isView(e)){t.add(e.buffer);return}if(e instanceof ArrayBuffer){t.add(e);return}for(let t of Object.values(Object.getOwnPropertyDescriptors(e)))`value`in t&&i(t.value)}};i(e);for(let e of t)r+=e.byteLength;return r}var Fg=96,Ig=12,Lg=class{placeholders;password;previews=new Map;detailed=new Map;overviewKinds=new Map;attempted=new Set;failed=new Set;evictedPreviews=new Set;displayPages=new Map;boundDisplayPages=null;boundDisplayScene=null;placedRasters=new WeakMap;wanted=[];wantedDetail=[];detailCandidates=[];detailKey=``;visibleKey=``;reportedPreviewEviction=!1;allPreviews=!1;initialProgress=null;retainAllOverviews=!1;closed=!1;paused=!1;running=null;operation=null;completeOperation=null;pagePreviewRequests=new Set;activePagePreview=null;session;onChange;onTiming=null;reportedCompatibilityPages=new Set;options;sourcePages;constructor(e,t,n={}){this.session=e,this.onChange=t,this.options=n,this.password=n.password,this.sourcePages=bo(e.info.pages.length,n.pages).map(e=>e-1),this.placeholders=this.sourcePages.map(t=>{let n=e.info.pages[t],r=Ji(),i={minX:0,minY:0,maxX:n.width,maxY:n.height};return r.pageCount=1,r.pageRects=Float32Array.of(0,0,n.width,n.height),r.pendingPagePreviews=Uint8Array.of(1),r.pageTextRanges=Uint32Array.of(0,0),r.bounds=r.pageBounds=i,r})}get pageCount(){return this.placeholders.length}setOnChange(e){this.onChange=e}setPerformanceListener(e){this.onTiming=e}get previewCount(){return this.previews.size}get detailedCount(){return this.detailed.size}get requiresPageDemand(){return this.previews.size!==this.pageCount||[...this.overviewKinds.values()].some(e=>e!==`vector`)}get residentBytes(){return[...this.previews.values(),...this.detailed.values()].reduce((e,t)=>e+t.bytes,0)}get pageScenes(){return this.placeholders.map((e,t)=>this.pageScene(t))}async getPagePreviewScene(e,t){if(t.signal?.throwIfAborted(),this.closed)throw Error(`The PDF page loader is closed.`);if(!Number.isInteger(e)||e<0||e>=this.pageCount)throw RangeError(`Invalid page index.`);if(!Number.isSafeInteger(t.maximumDimension)||t.maximumDimension<16||t.maximumDimension>4096)throw RangeError(`Page preview dimensions must be integers from 16 through 4096.`);let n=this.pagePreviewSource(e);return n?Ng(n,t.maximumDimension):await new Promise((n,r)=>{let i=()=>{this.pagePreviewRequests.delete(a),a.cleanup(),this.activePagePreview===a&&this.operation?.abort(t.signal?.reason),r(t.signal?.reason??new DOMException(`Page preview cancelled.`,`AbortError`))},a={index:e,maximumDimension:t.maximumDimension,resolve:n,reject:r,cleanup:()=>t.signal?.removeEventListener(`abort`,i)};this.pagePreviewRequests.add(a),t.signal?.addEventListener(`abort`,i,{once:!0}),t.signal?.aborted?i():this.start()})}get displayPageScenes(){return this.placeholders.map((e,t)=>{let n=this.previews.get(t)?.scene;if(!n||this.overviewKinds.get(t)===`vector`||this.options.ocrTextOnly)return this.pageScene(t);let r=this.displayPages.get(t);(!r||r.overview!==n)&&(r={overview:n,scene:tg(n),detailed:!1},this.displayPages.set(t,r));let i=this.detailed.get(t)?.scene;if(i&&ng(i)&&!r.detailed){let e=rg(n,i);if(!e)return this.reportedCompatibilityPages.has(t)||(this.reportedCompatibilityPages.add(t),console.warn(`[HEPR] Page ${t+1} retains its complete scene update path to preserve compositing effects.`)),this.pageScene(t);r.scene=e,r.detailed=!0}return r.scene})}bindDisplayScene(e,t=this.displayPageScenes){this.boundDisplayPages=t,this.boundDisplayScene=e}getDisplayUpdate(e){let t=this.displayPageScenes;if(e!==this.boundDisplayScene||!this.boundDisplayPages||t.some((e,t)=>e!==this.boundDisplayPages[t]))return null;let n=new Map,r=new Set,i=new Map;return e.rasterLayers.forEach((a,o)=>{if(!a.pageDemandSlot)return;let s=a.pageIndex,c=i.get(s)??0;i.set(s,c+1);let l=this.wantedDetail.includes(s)?this.detailed.get(s)?.scene.rasterLayers[c]:void 0;if(!l){n.set(o,a);return}let u=this.placedRasters.get(l);u||this.placedRasters.set(l,u=new Map);let d=u.get(s);(!d||d.matrix[4]!==Math.fround(l.matrix[4]+e.pageRects[s*4]-t[s].pageRects[0])||d.matrix[5]!==Math.fround(l.matrix[5]+e.pageRects[s*4+1]-t[s].pageRects[1]))&&(d=ig(l,e,t[s],s),u.set(s,d)),n.set(o,d),r.add(s)}),{layers:n,rasterPages:r}}isDisplayUpdateCurrent(e,t){let n=this.getDisplayUpdate(e);return!!n&&n.layers.size===t.layers.size&&n.rasterPages.size===t.rasterPages.size&&[...n.rasterPages].every(e=>t.rasterPages.has(e))&&[...n.layers].every(([e,n])=>t.layers.get(e)===n)}pageScene(e,t=this.wantedDetail){return(t.includes(e)?this.detailed.get(e)?.scene:void 0)??this.previews.get(e)?.scene??this.detailed.get(e)?.scene??this.placeholders[e]}pagePreviewSource(e){return this.detailed.get(e)?.scene??(this.overviewKinds.get(e)===`vector`||this.options.ocrTextOnly?this.previews.get(e)?.scene:void 0)}update(e,t){if(this.closed||!(e.zoom>0))return;let n=e.width/e.zoom/2,r=e.height/e.zoom/2,i=Math.min(n,r)*.15,a=[];for(let o=0;o<this.pageCount;o++){let s=o*4,c=t[s],l=t[s+1],u=t[s+2],d=t[s+3];if(e.projection||e.localToClip){let t=e.projection?e.projection(o):e.localToClip;if(!t)continue;let n=[[c,l],[u,l],[c,d],[u,d]].map(([e,n])=>{let r=t[3]*e+t[7]*n+t[15];return r>1e-8?[(t[0]*e+t[4]*n+t[12])/r,(t[1]*e+t[5]*n+t[13])/r]:null}).filter(e=>e!==null);if(!n.length)continue;let r=n.map(e=>e[0]),i=n.map(e=>e[1]);if(n.length===4&&(Math.max(...r)<-1.15||Math.min(...r)>1.15||Math.max(...i)<-1.15||Math.min(...i)>1.15))continue;a.push({index:o,distance:Math.hypot((Math.min(...r)+Math.max(...r))/2,(Math.min(...i)+Math.max(...i))/2),detail:n.length!==4||Math.max((Math.max(...r)-Math.min(...r))*e.width/2,(Math.max(...i)-Math.min(...i))*e.height/2)>(this.wantedDetail.includes(o)?224:256)});continue}u<e.cameraCenterX-n-i||c>e.cameraCenterX+n+i||d<e.cameraCenterY-r-i||l>e.cameraCenterY+r+i||a.push({index:o,distance:Math.hypot((c+u)/2-e.cameraCenterX,(l+d)/2-e.cameraCenterY),detail:Math.max(u-c,d-l)*e.zoom>(this.wantedDetail.includes(o)?224:256)})}a.sort((e,t)=>e.distance-t.distance||e.index-t.index),this.wanted=a.map(e=>e.index);let o=this.wanted.join(`,`);if(o!==this.visibleKey){this.visibleKey=o;for(let e of this.wanted)this.evictedPreviews.delete(e)}this.detailCandidates=a.filter(e=>e.detail).map(e=>e.index),this.refreshDetailDemand(),this.activePagePreview&&this.next()&&this.operation?.abort(),this.start()}refreshDetailDemand(){let e=this.wantedDetail;this.wantedDetail=this.options.ocrTextOnly?[]:this.detailCandidates.filter(e=>this.overviewKinds.get(e)!==`vector`).slice(0,Ig);let t=this.wantedDetail.join(`,`);if(t!==this.detailKey){this.detailKey=t,this.attempted.clear();for(let e of this.wantedDetail)this.evictedPreviews.delete(e);for(let t of e)this.wantedDetail.includes(t)||this.evictedPreviews.delete(t);[...e,...this.wantedDetail].some(t=>this.pageScene(t,e)!==this.pageScene(t))&&this.notifyChange()}}requestAllPreviews(){this.allPreviews=!0,this.activePagePreview&&this.next()&&this.operation?.abort(),this.start()}async loadInitialOverviews(e,t=!1){e?.throwIfAborted();let n=()=>this.pause();e?.addEventListener(`abort`,n,{once:!0}),this.initialProgress=Xi(this.options.onProgress),this.retainAllOverviews||=t;try{this.requestAllPreviews(),await this.whenIdle(),e?.throwIfAborted()}finally{this.initialProgress=null,e?.removeEventListener(`abort`,n)}}async loadCompletePageScenes(e={}){if(e.signal?.throwIfAborted(),this.closed)throw Error(`The PDF page loader is closed.`);if(this.completeOperation)throw Error(`Complete PDF page extraction is already running.`);let t=this.completeOperation=new AbortController,n=()=>t.abort(e.signal?.reason);e.signal?.addEventListener(`abort`,n,{once:!0});let r=this.paused;this.pause();let i=Xi(e.onProgress),a=()=>{if(t.signal.throwIfAborted(),this.closed)throw Error(`The PDF page loader is closed.`)};try{await this.whenIdle(),a();let e=[];for(let n=0;n<this.pageCount;n++){a();let r=this.sourcePages[n],o={stage:`pdf-page`,sourceType:`pdf`,executionPath:`worker`,unit:`pages`,total:this.pageCount,pageIndex:n,pageCount:this.pageCount,sourcePageIndex:r,sourcePageCount:this.session.info.pages.length};i.report(.12+n/this.pageCount*.82,{...o,processed:n});let s=this.options.ocrTextOnly?void 0:this.detailed.get(n)?.scene??(this.overviewKinds.get(n)===`vector`?this.previews.get(n)?.scene:void 0),c=s??await this.session.compileVectorPage(r,{ocrTextOnly:!1,signal:t.signal,optimization:this.options.enableSegmentMerge===!1&&this.options.enableInvisibleCull===!1?`none`:`safe`,enableSegmentMerge:this.options.enableSegmentMerge!==!1,enableInvisibleCull:this.options.enableInvisibleCull!==!1,...this.options.annotationAppearances?{annotationAppearances:this.options.annotationAppearances}:{},onProgress:e=>Wa(i,e,{selectionIndex:n,selectedPageCount:this.pageCount,sourcePageCount:this.session.info.pages.length})});a(),!s&&this.options.extractTextContent===!0&&(c.textContent=qa(c,0)),e.push(c),i.report(.12+(n+1)/this.pageCount*.82,{...o,processed:n+1})}return a(),i.complete({stage:`compile`,sourceType:`pdf`,executionPath:`worker`,unit:`pages`,processed:e.length,total:e.length,pageCount:e.length,sourcePageCount:this.session.info.pages.length}),a(),e}finally{e.signal?.removeEventListener(`abort`,n),this.completeOperation===t&&(this.completeOperation=null),this.paused=r,!r&&!this.closed&&this.start()}}pause(){this.paused=!0,this.operation?.abort()}resume(){!this.closed&&!this.completeOperation&&(this.paused=!1,this.start())}async close(){if(!this.closed){this.closed=!0,this.operation?.abort(),this.completeOperation?.abort(new DOMException(`PDF page loader closed.`,`AbortError`));for(let e of this.pagePreviewRequests)e.cleanup(),e.reject(new DOMException(`PDF page loader closed.`,`AbortError`));this.pagePreviewRequests.clear();try{await this.session.close()}finally{await this.running,this.previews.clear(),this.detailed.clear(),this.overviewKinds.clear(),this.displayPages.clear(),this.boundDisplayPages=null,this.boundDisplayScene=null,this.onTiming=null}}}async whenIdle(){for(;this.running;)await this.running}async notifyChange(){try{await this.onChange()}catch(e){console.warn(`[HEPR] Demand-driven PDF page update failed.`,e)}}start(){this.running||this.closed||this.paused||this.completeOperation||(this.running=this.pump().finally(()=>{this.running=null,(this.next()||this.pagePreviewRequests.size)&&this.start()}),this.running.catch(e=>console.warn(`[HEPR] Demand-driven PDF page update failed.`,e)))}next(){for(let e of this.wantedDetail)if(this.previews.has(e)&&!this.detailed.has(e)&&!this.attempted.has(e)&&!this.failed.has(e))return{index:e,detail:!0};for(let e of this.wanted)if(!this.previews.has(e)&&!this.failed.has(e)&&!this.evictedPreviews.has(e))return{index:e,detail:!1};if(this.allPreviews){for(let e=0;e<this.pageCount;e++)if(!this.previews.has(e)&&!this.failed.has(e)&&!this.evictedPreviews.has(e))return{index:e,detail:!1}}return null}async pump(){for(;!this.closed&&!this.paused;){let e=this.next();if(!e){let e=this.pagePreviewRequests.values().next().value;if(!e)return;await this.loadPagePreview(e);continue}let{index:t,detail:n}=e;n&&this.attempted.add(t);let r=this.operation=new AbortController,i=this.initialProgress,a={stage:`pdf-page`,sourceType:`pdf`,executionPath:`worker`,unit:`pages`,total:this.pageCount,pageIndex:t,pageCount:this.pageCount,sourcePageIndex:this.sourcePages[t],sourcePageCount:this.session.info.pages.length};i?.report(.12+t/this.pageCount*.82,{...a,processed:t});try{let e=performance.now(),a=await this.session.compileVectorPage(this.sourcePages[t],{ocrTextOnly:this.options.ocrTextOnly,signal:r.signal,optimization:`safe`,enableSegmentMerge:this.options.enableSegmentMerge!==!1,enableInvisibleCull:this.options.enableInvisibleCull!==!1,...n?{}:{previewMaxDimension:Fg},...this.options.annotationAppearances?{annotationAppearances:this.options.annotationAppearances}:{},onProgress:e=>{i&&Wa(i,e,{selectionIndex:t,selectedPageCount:this.pageCount,sourcePageCount:this.session.info.pages.length})}});try{this.onTiming?.(n?`pageSwap.decode`:`pageSwap.overview`,performance.now()-e)}catch(e){console.warn(`[HEPR] Page timing listener failed.`,e)}if(this.options.extractTextContent===!0&&(a.textContent=qa(a,0)),this.closed||r.signal.aborted){this.attempted.delete(t);continue}let o=n?this.detailed:this.previews;(!n||this.wantedDetail.includes(t))&&(o.set(t,{scene:a,bytes:Pg(a)}),n||(this.overviewKinds.set(t,a.pdfOverviewKind??(a.rasterLayers.length||a.retainedPages?.length?`raster`:`vector`)),this.refreshDetailDemand()),(n||!this.retainAllOverviews)&&this.trim(o,n),i||await this.notifyChange())}catch(e){r.signal.aborted||this.closed?this.attempted.delete(t):(this.failed.add(t),this.placeholders[t].pendingPagePreviews?.fill(0),console.warn(`[HEPR] Page ${t+1} could not be loaded; other pages remain available.`,e),i||await this.notifyChange())}finally{this.operation===r&&(this.operation=null)}i?.report(.12+(t+1)/this.pageCount*.82,{...a,processed:t+1}),i||await new Promise(e=>setTimeout(e,0))}}async loadPagePreview(e){let t=this.operation=new AbortController;this.activePagePreview=e;try{let n=this.pagePreviewSource(e.index)??await this.session.compileVectorPage(this.sourcePages[e.index],{signal:t.signal,optimization:`safe`,ocrTextOnly:this.options.ocrTextOnly,previewMaxDimension:e.maximumDimension,previewAppearance:!0,enableSegmentMerge:this.options.enableSegmentMerge!==!1,enableInvisibleCull:this.options.enableInvisibleCull!==!1,...this.options.annotationAppearances?{annotationAppearances:this.options.annotationAppearances}:{}});if(t.signal.aborted||!this.pagePreviewRequests.has(e))return;let r=Ng(n,e.maximumDimension);this.pagePreviewRequests.delete(e),e.cleanup(),e.resolve(r)}catch(n){if(t.signal.aborted||!this.pagePreviewRequests.has(e))return;this.pagePreviewRequests.delete(e),e.cleanup(),e.reject(n)}finally{this.operation===t&&(this.operation=null),this.activePagePreview=null}await new Promise(e=>setTimeout(e,0))}trim(e,t){let n=Sg().bytes,r=[...e.values()].reduce((e,t)=>e+t.bytes,0);for(;e.size>1&&(r>n||t&&e.size>Ig);){let n=e=>{let n=(t?this.wantedDetail:this.wanted).indexOf(e);return n<0?1/0:n},i=[...e.keys()].sort((e,t)=>n(t)-n(e))[0];r-=e.get(i).bytes,e.delete(i),t||this.displayPages.delete(i),t||(this.evictedPreviews.add(i),this.reportedPreviewEviction||(this.reportedPreviewEviction=!0,console.warn(`[HEPR] PDF preview cache reached its automatic memory target; evicted previews reload as you navigate.`)))}}};async function Rg(t,n,r,i){let{openPdfInBrowserWorker:a,openPdfInNodeWorker:o}=await e(async()=>{let{openPdfInBrowserWorker:e,openPdfInNodeWorker:t}=await import(`./workerClient-COglgcVC.js`);return{openPdfInBrowserWorker:e,openPdfInNodeWorker:t}},__vite__mapDeps([0,1,2,3,4]),import.meta.url),s=await Va(),c=await(typeof globalThis.process?.versions?.node==`string`?o:a)({kind:`bytes`,bytes:new Uint8Array(t),ownership:`copy`},{repair:`safe`,password:n.password,signal:i,missingFontResolver:s,imageCodecResolver:n.imageCodecResolver,iccEngine:n.iccEngine,embeddedFontPaint:n.embeddedFontPaint,iccTransformResolver:n.iccTransformResolver,onDiagnostic:n.onDiagnostic});try{return new Lg(c,r,n)}catch(e){throw await c.close(),e}}var zg=Le({isPdfPasswordError:()=>Bg,loadPdfSceneFromSource:()=>Vg,readPdfObjectSourceBytes:()=>Ug});function Bg(e){if(!(e instanceof Error))return!1;let{code:t,details:n}=e;return t===`encrypted`&&(n?.reason===`password-required`||n?.reason===`password-incorrect`)}async function Vg(e,t={},n=t.signal,r=!1,i){n?.throwIfAborted();let a=Hg(e,t,n,r,i);try{return await m(a,n)}catch(e){throw a.then(e=>e.pageDemand?.close()).catch(()=>{}),e}}async function Hg(e,t,n,r=!1,i){n?.throwIfAborted();let a=Xi(t.onProgress),s=await Ug(e,a.child(0,.16),n);n?.throwIfAborted();let c=Jg(e,s,t.sourceKind),l=t.sourceLabel??Yg(e,c);if(c===`pdf`){o(t.annotationAppearances),t={...t,...Ea(t)};let e={compressScans:t.compressScans,ocrTextOnly:t.ocrTextOnly,password:t.password,imageCodecResolver:t.imageCodecResolver,iccTransformResolver:t.iccTransformResolver,iccEngine:t.iccEngine,annotationAppearances:t.annotationAppearances,embeddedFontPaint:t.embeddedFontPaint,onDiagnostic:t.onDiagnostic,enableSegmentMerge:t.segmentMerge!==!1,enableInvisibleCull:t.invisibleCull!==!1,pages:t.pages,extractTextContent:t.extractText===!0,onProgress:a.child(.16,.9,{sourceType:`pdf`}).toCallback()};if(r&&t.pageLoading!==`eager`&&!t.compressScans){let r=await Rg($g(s),e,()=>{},n);try{n?.throwIfAborted();let e=t.pageLoading===`auto`;if((!e||r.pageCount<=16)&&await r.loadInitialOverviews(n,!e),e&&r.pageCount>16||r.requiresPageDemand){let e=Qg(t.maxPagesPerRow,r.pageCount),i=uh(Xa(r.displayPageScenes,e,t.onDiagnostic));return i.sourcePdfByteLength=s.byteLength,r.bindDisplayScene(i),a.complete({sourceType:`pdf`}),n?.throwIfAborted(),{scene:i,sourceLabel:l,sourceKind:c,sourceBytes:s,pageDemand:r,sourceOptions:t}}let i=Qg(t.maxPagesPerRow,r.pageCount),o=uh(Xa(r.pageScenes,i,t.onDiagnostic));return o.sourcePdfByteLength=s.byteLength,await r.close(),a.complete({sourceType:`pdf`}),n?.throwIfAborted(),{scene:o,sourceLabel:l,sourceKind:c,sourceBytes:s,sourceOptions:t}}catch(e){throw await r.close(),e}}let u=await Ia($g(s),e,n,`transfer`,i);n?.throwIfAborted();let d=uh(Xa(u,Qg(t.maxPagesPerRow,u.length),t.onDiagnostic));return d.sourcePdfByteLength=s.byteLength,n?.throwIfAborted(),a.report(.93,{stage:`compile`,sourceType:`pdf`}),n?.throwIfAborted(),a.complete({sourceType:`pdf`}),n?.throwIfAborted(),{scene:d,sourceLabel:l,sourceKind:c,sourceBytes:s,sourceOptions:t}}let u=await qg(Ah($g(s),{signal:n,onProgress:a.child(.16,.95,{sourceType:`hep`}).toCallback()}),n);return n?.throwIfAborted(),a.complete({sourceType:`hep`}),n?.throwIfAborted(),{scene:u,sourceLabel:l,sourceKind:c,sourceBytes:s}}async function Ug(e,t,n){if(n?.throwIfAborted(),t?.report(0,{stage:`source`,unit:`bytes`}),n?.throwIfAborted(),e instanceof Uint8Array){let r=new Uint8Array(e);return t?.complete({stage:`source`,unit:`bytes`,processed:r.length,total:r.length}),n?.throwIfAborted(),r}if(e instanceof ArrayBuffer){let r=new Uint8Array(e).slice();return t?.complete({stage:`source`,unit:`bytes`,processed:r.length,total:r.length}),n?.throwIfAborted(),r}if(a_(e)){let r=await qg(e.arrayBuffer(),n);n?.throwIfAborted();let i=new Uint8Array(r);return t?.complete({stage:`source`,unit:`bytes`,processed:i.length,total:i.length}),n?.throwIfAborted(),i}if(typeof e==`string`){let r=await Wg(e,t,n);return n?.throwIfAborted(),t?.complete({stage:`source`,unit:`bytes`,processed:r.length,total:r.length}),n?.throwIfAborted(),r}throw Error(`Unsupported source type. Expected File, Blob, Uint8Array, ArrayBuffer, or string.`)}async function Wg(e,t,n){n?.throwIfAborted();let r=e.trim();if(r.length===0)throw Error(`Source string is empty.`);if(t_(r)){let e=n_(r);return n?.throwIfAborted(),t?.report(1,{stage:`source`,unit:`bytes`,processed:e.length,total:e.length}),e}let i=r_(r);if(i&&(Sa(i)||jo(i)||Mo(i)))return n?.throwIfAborted(),t?.report(1,{stage:`source`,unit:`bytes`,processed:i.length,total:i.length}),i;let a=await qg(fetch(r,{cache:`no-store`,signal:n}),n);if(n?.throwIfAborted(),!a.ok)throw Error(`Failed to load source path/URL (${a.status} ${a.statusText}).`);return Gg(a,t,n)}async function Gg(e,t,n){n?.throwIfAborted();let r=Number(e.headers.get(`content-length`)),i=Number.isFinite(r)&&r>0?Math.trunc(r):void 0;if(!e.body||!t?.enabled){let r=await qg(e.arrayBuffer(),n);n?.throwIfAborted();let a=new Uint8Array(r);return t?.report(1,{stage:`source`,unit:`bytes`,processed:a.length,total:i??a.length}),n?.throwIfAborted(),a}let a=e.body.getReader(),o=[],s=0;t.report(0,{stage:`source`,unit:`bytes`,processed:0,total:i});let c=()=>{a.cancel(Kg(n)).catch(()=>{})};n?.addEventListener(`abort`,c,{once:!0});try{for(;;){n?.throwIfAborted();let{done:e,value:r}=await a.read();if(n?.throwIfAborted(),e)break;r&&(o.push(r),s+=r.length,i&&t.report(s/i,{stage:`source`,unit:`bytes`,processed:s,total:i}))}}finally{n?.removeEventListener(`abort`,c),a.releaseLock()}let l=new Uint8Array(s),u=0;for(let e of o)l.set(e,u),u+=e.length;return t.report(1,{stage:`source`,unit:`bytes`,processed:s,total:i??s}),n?.throwIfAborted(),l}function Kg(e){if(e?.aborted)try{e.throwIfAborted()}catch(e){return e}return new DOMException(`The PDF source load was aborted.`,`AbortError`)}async function qg(e,t){return t?(t.throwIfAborted(),new Promise((n,r)=>{let i=!1,a=e=>{i||(i=!0,t.removeEventListener(`abort`,o),e())},o=()=>{a(()=>r(Kg(t)))};t.addEventListener(`abort`,o,{once:!0}),t.aborted&&o(),e.then(e=>a(()=>n(e)),e=>a(()=>r(e)))})):e}function Jg(e,t,n){if(n===`pdf`||n===`hep`)return n;if(n!==void 0&&n!==`auto`)throw Error(`sourceKind must be "pdf", "hep", or "auto".`);let r=Xg(e);if(r){let e=r.toLowerCase();if(e.endsWith(`.pdf`))return`pdf`;if(e.endsWith(`.hep`)||e.endsWith(`.zip`))return`hep`}if(jo(t)||Mo(t))return`hep`;if(Sa(t))return`pdf`;throw Error(`Unable to detect source kind. Pass options.sourceKind as "pdf" or "hep".`)}function Yg(e,t){return Xg(e)||(t===`pdf`?`document.pdf`:`parsed-data.hep`)}function Xg(e){if(typeof e==`string`)return Zg(e);if(o_(e)){let t=e.name.trim();return t.length>0?t:null}return null}function Zg(e){let t=e.trim();if(t.length===0)return null;if(t_(t)){let e=i_(t)?.toLowerCase();return e===`application/pdf`?`inline.pdf`:e===`application/x-hep`||e===`application/zip`||e===`application/x-zip-compressed`?`inline.hep`:`inline-data.bin`}if(e_(t))return null;if(t.startsWith(`http://`)||t.startsWith(`https://`))try{return new URL(t).pathname.split(`/`).filter(Boolean).pop()??t}catch{return t}return t.split(/[?#]/,1)[0].replace(/\\/g,`/`).split(`/`).filter(Boolean).pop()??t}function Qg(e,t){return s_(typeof e!=`number`||!Number.isFinite(e)?Math.ceil(Math.sqrt(Math.max(1,Math.trunc(t)))):Math.trunc(e),1,100)}function $g(e){return new Uint8Array(e).buffer}function e_(e){let t=e.replace(/\s+/g,``);return t.length>=64&&t.length%4==0&&/^[A-Za-z0-9+/]+={0,2}$/.test(t)}function t_(e){return/^data:[^,]*;base64,/i.test(e)}function n_(e){let t=e.indexOf(`,`);if(t<0)throw Error(`Malformed base64 data URL.`);let n=r_(e.slice(t+1));if(!n)throw Error(`Failed to decode base64 data URL.`);return n}function r_(e){let t=e.replace(/\s+/g,``);if(t.length===0||t.length%4!=0||!/^[A-Za-z0-9+/]+={0,2}$/.test(t))return null;try{let e=atob(t),n=new Uint8Array(e.length);for(let t=0;t<e.length;t+=1)n[t]=e.charCodeAt(t);return n}catch{return null}}function i_(e){let t=/^data:([^;,]+)?(?:;[^,]*)?,/i.exec(e);if(!t)return null;let n=t[1]?.trim();return n&&n.length>0?n:null}function a_(e){return typeof Blob<`u`&&e instanceof Blob}function o_(e){return typeof File<`u`&&e instanceof File}function s_(e,t,n){return Math.min(n,Math.max(t,e))}var c_=()=>({conditions:new Set,backdrop:!1,all:!1});function l_(e,t){for(let n of t.conditions)e.conditions.add(n);e.backdrop||=t.backdrop,e.all||=t.all}var u_=class{page;commands=new WeakMap;resources=new Map;active=new Set;constructor(e){this.page=e}span(e,t){let n=this.page.displayProgram.groups[this.page.displayProgram.rootGroupIndex],r=c_();if(!n||e<0||t<1||e+t>n.commands.length)r.all=!0;else{for(let i=e;i<e+t;i++)l_(r,this.command(n.commands[i]));if(n.softMaskGroupIndex>=0&&l_(r,this.group(n.softMaskGroupIndex)),r.backdrop)for(let t=0;t<e;t++)l_(r,this.command(n.commands[t]))}return r.all?Uint32Array.from({length:this.page.stores.optionalContent.defaultVisible.length},(e,t)=>t):Uint32Array.from(r.conditions)}resource(e,t){let n=this.resources.get(e);if(n)return n;let r=c_();return this.active.has(e)||this.active.size>64?(r.all=!0,r):(this.active.add(e),t(r),this.active.delete(e),this.resources.set(e,r),r)}group(e){return this.resource(`group:${e}`,t=>{let n=this.page.displayProgram.groups[e];if(!n){t.all=!0;return}t.backdrop=n.blendMode!==`Normal`||n.knockout||n.backdropPaintIndex>=0||!n.isolated,n.softMaskGroupIndex>=0&&l_(t,this.group(n.softMaskGroupIndex));for(let e of n.commands)l_(t,this.command(e))})}program(e){return this.resource(`program:${e}`,t=>{let n=this.page.displayProgram.programs[e];if(!n){t.all=!0;return}for(let e of n.commands)l_(t,this.command(e))})}pattern(e){return this.resource(`pattern:${e}`,t=>{let n=this.page.stores.patterns.programIndices[e];n===void 0?t.all=!0:n>=0&&l_(t,this.program(n))})}paint(e){return this.resource(`paint:${e}`,t=>{this.page.stores.paints.kinds[e]===ye.Pattern&&l_(t,this.pattern(this.page.stores.paints.resourceIndices[e]))})}command(e){let t=this.commands.get(e);if(t)return t;let n=c_();if(e.optionalContentIndex>=0&&n.conditions.add(e.optionalContentIndex),e.kind===`invoke-group`)l_(n,this.group(e.groupIndex));else if(e.kind===`invoke-program`)l_(n,this.program(e.programIndex)),e.type3PaintIndex>=0&&l_(n,this.paint(e.type3PaintIndex));else if(`paintIndex`in e&&e.paintIndex>=0&&l_(n,this.paint(e.paintIndex)),`fillPaintIndex`in e&&(e.fillPaintIndex>=0&&l_(n,this.paint(e.fillPaintIndex)),e.strokePaintIndex>=0&&l_(n,this.paint(e.strokePaintIndex))),e.source===`patterns`)for(let t=e.first;t<e.first+e.count;t++)l_(n,this.pattern(t));else e.source===`glyphs`&&l_(n,this.resource(`glyph-programs`,e=>{for(let t of new Set(this.page.stores.fonts.type3ProgramIndices))t>=0&&l_(e,this.program(t))}));return this.commands.set(e,n),n}};function d_(e,t){let n=e.page.stores.optionalContent,r=new Uint8Array(n.defaultVisible.length);if(e.optionalContentConditions.length!==r.length)throw RangeError(`Retained visibility map has an invalid length.`);for(let n=0;n<r.length;n++){let i=e.optionalContentConditions[n];if(i<-1||i>=t.conditions.length)throw RangeError(`Retained visibility map references an unknown condition.`);r[n]=+(i<0||t.conditions[i]!==0)}return{...e.page,stores:{...e.page.stores,optionalContent:{...n,defaultVisible:r}}}}var f_=class{scene;nodes=[];dependencies=[];renderSpan;layers=new Map;pageVisibility;visible=new Set;generation=0;disposed=!1;constructor(t,n){this.scene=t,this.renderSpan=n??(async(t,n,r,i)=>{let{renderNativeRetainedCommandSpan:a}=await e(async()=>{let{renderNativeRetainedCommandSpan:e}=await import(`./retainedPageCompositor-b7lXlUBy.js`);return{renderNativeRetainedCommandSpan:e}},__vite__mapDeps([16,1,3,17]),import.meta.url);return a(t,n,r,i)});let r=t.retainedPages?.map(e=>new u_(e.page))??[],i=e=>{for(let n of e)n.kind===`retained`?(this.nodes.push(n),this.layers.set(n.rasterIndex,t.rasterLayers[n.rasterIndex]),this.dependencies.push(r[n.retainedPage].span(n.firstCommand,n.count))):n.kind===`group`&&(i(n.children),n.softMask&&i(n.softMask.children))};t.paintGraph&&i(t.paintGraph.roots),this.pageVisibility=t.retainedPages?.map(e=>e.page.stores.optionalContent.defaultVisible.slice())??[],this.visible=this.visibleSlots(l(t))}getLayers(){return new Map(this.layers)}async prepare(e,t){if(this.disposed)throw Error(`Retained page replay has been disposed.`);t.signal.throwIfAborted();let n=++this.generation,r=new Map(this.layers),i=new Map,a=this.scene.retainedPages?.map(t=>d_(t,e))??[],o=a.map(e=>e.stores.optionalContent.defaultVisible),s=this.visibleSlots(e),c=e=>{if(!(n!==this.generation||this.disposed))try{t.onProgress?.(e)}catch{}};c(0);try{for(let e=0;e<this.nodes.length;e++){t.signal.throwIfAborted();let n=this.nodes[e],r=this.scene.rasterLayers[n.rasterIndex],l=o[n.retainedPage],u=this.pageVisibility[n.retainedPage],d=this.dependencies[e].some(e=>l[e]!==u[e]);if(!s.has(n.rasterIndex))this.visible.has(n.rasterIndex)&&i.set(n.rasterIndex,{...r,monochrome:void 0,width:1,height:1,data:new Uint8Array(4)});else if(d||!this.visible.has(n.rasterIndex)){await m(new Promise(e=>setTimeout(e,0)),t.signal);let e=await m(this.renderSpan(a[n.retainedPage],n.firstCommand,n.count,t.signal),t.signal);if(t.signal.throwIfAborted(),e){let t=this.scene.retainedPages[n.retainedPage].matrix,a=e.matrix,o=new Float32Array([t[0]*a[0]+t[2]*a[1],t[1]*a[0]+t[3]*a[1],t[0]*a[2]+t[2]*a[3],t[1]*a[2]+t[3]*a[3],t[0]*a[4]+t[2]*a[5]+t[4],t[1]*a[4]+t[3]*a[5]+t[5]]);i.set(n.rasterIndex,{...e,matrix:o,paintOrder:r.paintOrder,pageIndex:r.pageIndex})}else i.set(n.rasterIndex,{...r,monochrome:void 0,width:1,height:1,data:new Uint8Array(4)})}c(Math.floor((e+1)/this.nodes.length*100))}for(let[e,t]of i)r.set(e,t);return{layers:i,commit:()=>{if(t.signal.throwIfAborted(),this.disposed||n!==this.generation)throw new DOMException(`Retained replay superseded.`,`AbortError`);this.layers=r,this.pageVisibility=o,this.visible=s}}}finally{c(null)}}visibleSlots(e){return new Set(re(this.scene,t=>t===void 0||e.conditions[t]!==0).filter(e=>e.kind===`retained`).map(e=>e.kind===`retained`?e.node.rasterIndex:-1))}dispose(){this.disposed=!0,this.generation++,this.layers.clear(),this.visible.clear(),this.pageVisibility=[]}};function p_({container:e,controller:t}){let n=e.ownerDocument;e.innerHTML=`<details class="pdf-layers"><summary>PDF Layers</summary>
    <fieldset>
    <label class="pdf-layers-all" title="Show or hide all available layers, including filtered-out layers. Locked layers stay unchanged; mutually exclusive layers keep their current choice."><input type="checkbox" />All</label>
    <label class="pdf-layers-filter">Filter layers<input type="search" placeholder="Layer name" aria-label="Filter PDF layers" /></label>
    <div class="pdf-layers-list"></div>
    <button type="button">Reset to PDF defaults</button>
    </fieldset>
    <div class="pdf-layers-status" role="status" aria-live="polite"></div>
    <progress max="100" hidden aria-label="Preparing PDF layers"></progress></details>`;let r=e.querySelector(`.pdf-layers-all input`),i=e.querySelector(`fieldset`),a=e.querySelector(`input[type="search"]`),o=e.querySelector(`.pdf-layers-list`),s=e.querySelector(`button`),c=e.querySelector(`.pdf-layers-status`),l=e.querySelector(`progress`),u=!1,d=0,f=0;async function p(e){let t=d;f++,c.textContent=`Applying layer visibility…`;try{await e(),!u&&t===d&&(c.textContent=``)}catch(e){!u&&t===d&&!(e instanceof DOMException&&e.name===`AbortError`)&&(c.textContent=`Layer change failed: ${e instanceof Error?e.message:String(e)}. Try again or reset to PDF defaults.`)}finally{!u&&t===d&&(f--,m())}}function m(){if(u)return;let e=t.getLayers(),i=t.getAllLayerVisibility();r.checked=i.checked,r.indeterminate=i.indeterminate,r.disabled=i.disabled;let c=new Map(e.map(e=>[e.id,e])),l=new Set,d=a.value.trim().toLocaleLowerCase();if(o.replaceChildren(),s.disabled=e.length===0,a.disabled=e.length===0,!e.length){o.textContent=`This PDF has no optional-content layers.`;return}let f=(e,r)=>{for(let i of e){let e=n.createElement(`div`);if(e.className=`pdf-layer-branch`,i.kind===`group`){let r=c.get(i.groupId);if(!r)continue;if(l.add(r.id),r.name.toLocaleLowerCase().includes(d)){let i=n.createElement(`label`);i.title=`${r.name}\n${r.id}${r.locked?`
Locked by the PDF`:``}`;let a=n.createElement(`input`);a.type=`checkbox`,a.checked=r.visible,a.disabled=r.locked||!r.usedInView,a.addEventListener(`change`,()=>{p(()=>t.setLayerVisibility(r.id,a.checked))});let o=n.createElement(`span`);o.textContent=r.name||`Unnamed layer`,i.append(a,o),e.append(i)}}else if(!d||i.label.toLocaleLowerCase().includes(d)){let t=n.createElement(`div`);t.textContent=i.label,t.className=`pdf-layer-label`,e.append(t)}if(i.children?.length){let t=n.createElement(`div`);t.className=`pdf-layer-children`,f(i.children,t),t.childNodes.length&&e.append(t)}e.childNodes.length&&r.append(e)}};f(t.getLayerOrder(),o),f(e.filter(e=>!l.has(e.id)).map(e=>({kind:`group`,groupId:e.id})),o),o.childNodes.length||(o.textContent=e.length?`No matching layers.`:`This PDF has no optional-content layers.`)}let h=()=>{p(()=>t.setAllLayerVisibility(r.checked))},g=()=>{p(()=>t.resetLayerVisibility())};r.addEventListener(`change`,h),a.addEventListener(`input`,m),s.addEventListener(`click`,g);let _=t.subscribeLayerVisibility(m);return m(),{refresh({resetFilter:e=!0}={}){u||(d++,f=0,e&&(a.value=``),c.textContent=``,l.hidden=!0,l.value=0,m())},setEnabled(e){u||(i.disabled=!e)},setProgress(e){u||(l.hidden=e===null,l.value=e??0,e===null?f||(c.textContent=``):c.textContent=`Preparing PDF layers… ${Math.round(e)}%`)},dispose(){u=!0,d++,_(),r.removeEventListener(`change`,h),a.removeEventListener(`input`,m),s.removeEventListener(`click`,g),e.replaceChildren()}}}var m_=500;function h_(e){return e.subtype!==`Popup`&&!(e.flags&35)}function g_(e){let t=`${e.subtype} · p. ${e.sourcePageIndex+1}`,n=e.destination??e.action?.destination,r=(e.contents||e.tooltip||e.subject||e.field?.name||e.action?.uri||n?.name||(n?.sourcePageIndex===void 0?void 0:`Go to page ${n.sourcePageIndex+1}`)||e.name)?.replace(/\s+/g,` `).trim(),i=r?`${t} — ${r.length>60?`${r.slice(0,59)}…`:r}`:t,a=[t,e.author,r,e.id].filter(Boolean).join(`
`);return{annotation:e,text:i,title:a,search:a.toLocaleLowerCase()}}function __({container:e,controller:t,onChange:n,onSelect:r,onHover:i}){let a=e.ownerDocument;e.innerHTML=`<details class="pdf-annotations"><summary>Annotations</summary>
    <label class="pdf-annotations-all"><input type="checkbox" /><span>All</span></label>
    <label class="pdf-annotations-filter">Filter annotations<input type="search" placeholder="Type, page, text or author" aria-label="Filter annotations" /></label>
    <button class="pdf-annotations-clear" type="button" disabled>Clear selection</button>
    <div class="pdf-annotations-list"></div>
    <div class="pdf-annotations-status" role="status" aria-live="polite"></div></details>`;let o=e.querySelector(`.pdf-annotations-all`),s=e.querySelector(`.pdf-annotations-all input`),c=e.querySelector(`.pdf-annotations-all span`),l=e.querySelector(`.pdf-annotations-filter`),u=e.querySelector(`.pdf-annotations-filter input`),d=e.querySelector(`.pdf-annotations-list`),f=e.querySelector(`.pdf-annotations-status`),p=e.querySelector(`.pdf-annotations`),m=e.querySelector(`.pdf-annotations-clear`);m.hidden=!r;let h=new Map,g=new Map,_=null,v=null,y=[],b=[],x=new Set,S=!1,C=0,w=0;function T(){let e=b.filter(e=>x.has(e.annotation.id)).length;s.checked=b.length>0&&e===0,s.indeterminate=e>0&&e<b.length;for(let[e,t]of h)for(let n of t)n.checked=!x.has(e);for(let[e,t]of g)for(let n of t)n.setAttribute(`aria-pressed`,String(e===_));m.disabled=_===null}async function E(e,r){let i=new Set(t.getAnnotationLayers().map(e=>e.annotationId)),a=e.filter(e=>i.has(e));if(!a.length)return;let o=C;w++,f.textContent=`Applying annotation visibility…`;let s,c=!1;try{await t.setAnnotationVisibility(a,r)}catch(e){c=!(e instanceof DOMException&&e.name===`AbortError`),s=e}if(S||o!==C)return;if(w--,!c){w||(f.textContent=``);return}let l=new Map(t.getAnnotationLayers().map(e=>[e.annotationId,e.visible]));for(let e of a)l.get(e)?x.delete(e):x.add(e);T(),f.textContent=`Annotation change failed: ${s instanceof Error?s.message:String(s)}. Try again.`,n?.()}function D(e,t){for(let n of e)t?x.delete(n):x.add(n);T(),E(e,t),n?.()}function O(){if(S)return;let e=u.value.trim().toLocaleLowerCase();b=e?y.filter(t=>t.search.includes(e)):y,o.hidden=l.hidden=y.length===0,c.textContent=e?`All matching`:`All`,o.title=e?`Turn every annotation that matches the filter on or off, including ones beyond the list limit.`:`Turn every annotation on or off, including ones beyond the list limit.`,g.size&&i?.(null),h.clear(),g.clear(),d.replaceChildren();let t=b.slice(0,m_),n=b.find(e=>e.annotation.id===_);n&&!t.includes(n)&&(t[t.length-1]=n);for(let e of t){let{annotation:t}=e,n=a.createElement(`div`);n.className=`pdf-annotation-row`;let o=a.createElement(`label`);o.title=e.title;let s=a.createElement(`input`);s.type=`checkbox`,s.addEventListener(`change`,()=>D([t.id],s.checked));let c=h.get(t.id)??[];c.push(s),h.set(t.id,c);let l=a.createElement(`span`);if(l.textContent=e.text,r){o.className=`pdf-annotation-visibility`,s.setAttribute(`aria-label`,`Show ${e.text}`),o.append(s);let c=a.createElement(`button`);c.type=`button`,c.className=`pdf-annotation-select`,c.title=e.title,c.append(l),c.addEventListener(`click`,()=>{j(t.id),r(t)}),c.addEventListener(`pointerenter`,()=>i?.(t)),c.addEventListener(`pointerleave`,()=>i?.(null)),c.addEventListener(`focus`,()=>i?.(t)),c.addEventListener(`blur`,()=>i?.(null));let u=g.get(t.id)??[];u.push(c),g.set(t.id,u),n.append(o,c)}else o.append(s,l),n.append(o);d.append(n)}if(!y.length)d.textContent=`This document has no annotations.`;else if(!b.length)d.textContent=`No matching annotations.`;else if(b.length>m_){let e=a.createElement(`div`);e.className=`pdf-annotations-more`,e.textContent=`Showing ${m_} of ${b.length}. Refine the filter to see the rest.`,d.append(e)}T()}function k(){if(S)return;let e=t.getScene();if(e===v){let e=t.getAnnotationLayers();for(let t of[!1,!0]){let n=e.filter(e=>e.visible!==t&&x.has(e.annotationId)!==t).map(e=>e.annotationId);n.length&&E(n,t)}return}v=e,_=null,C++,w=0,u.value=``,f.textContent=``,y=(e?.annotations??[]).filter(h_).map(g_),x=new Set(t.getAnnotationLayers().filter(e=>!e.visible).map(e=>e.annotationId)),O()}let A=()=>D(b.map(e=>e.annotation.id),s.checked);function j(e,t={}){if(!S){if(e!==null&&!y.some(t=>t.annotation.id===e))throw RangeError(`Unknown listed annotation: ${e}`);_=e,e!==null&&t.reveal?(p.open=!0,b.some(t=>t.annotation.id===e)||(u.value=``),O(),g.get(e)?.[0]?.scrollIntoView({block:`nearest`})):T()}}let M=()=>{j(null),i?.(null),r?.(null)};return m.addEventListener(`click`,M),s.addEventListener(`change`,A),u.addEventListener(`input`,O),k(),{isAnnotationEnabled(e){return!x.has(typeof e==`string`?e:e.id)},sceneChanged:k,selectAnnotation:j,getSelection:()=>_,dispose(){S||(S=!0,C++,s.removeEventListener(`change`,A),u.removeEventListener(`input`,O),m.removeEventListener(`click`,M),h.clear(),g.clear(),e.replaceChildren())}}}var $=32,v_=2147483648,y_=1073741824,b_=8,x_=Uint8Array.from({length:256},(e,t)=>{let n=0;for(let e=0;e<8;e++)n|=(t>>e&1)<<7-e;return n}),S_=Uint8Array.from({length:256},(e,t)=>(t&15)<<4|t>>4);function*C_(e,t,n,r,i){let a=he(t,n),o=i?8:1,s=(i?t*n:Math.ceil(t/8)*n)+r.data.length,c=[{width:t,height:n,rowBytes:0,byteOffset:0},...a.levels],l=5+c.length,u=c.reduce((e,t)=>e+Math.ceil(t.width/$)*Math.ceil(t.height/$),0);if(u>5e5||(l+u)*4>=s*.95)return;let d=new Uint32Array(Math.floor(s*.95/4));d.set([t,n,c.length,$,o]);let f=l+u,p=l;for(let e=0;e<c.length;e++)d[5+e]=p,p+=Math.ceil(c[e].width/$)*Math.ceil(c[e].height/$);let m=e=>{if(f+e.length>d.length)throw w_;let t=f;return d.set(e,f),f+=e.length,t},h=new Map,g=new Uint32Array($*o),_=new Uint32Array(128),v=0,y=0,b=0,x=(e,t)=>{let n=e[0]&(1<<t)-1,r=n*(t===1?4294967295:t===4?286331153:16843009)>>>0,i=2166136261,a=!0;for(let t of e)t!==r&&(a=!1),i=Math.imul(i^t,16777619);if(a)return v++,(v_|n)>>>0;let o=`${t}:${i>>>0}`,s=h.get(o)??[];for(let t of s)if(e.every((e,n)=>d[t+n]===e))return y++,t;if(s.length>=32)throw w_;let c=m(e);return s.push(c),h.set(o,s),c},S=e.data,C,w=new Map,T=i?void 0:e.symbols;if(T&&T.placements instanceof Int32Array&&Array.isArray(T.symbols)&&T.placements.length%3==0){S=new Uint8Array(e.data),C=Array.from({length:Math.ceil(t/$)*Math.ceil(n/$)},()=>[]);let r=Math.ceil(t/8),i=Math.ceil(t/$),a=!0,o=0,s=Math.min(2e8,t*n*8);for(let c=0;c<T.placements.length&&a;c+=3){let l=T.placements[c],u=T.placements[c+1],d=T.symbols[T.placements[c+2]];if(!d||!Number.isSafeInteger(d.width)||!Number.isSafeInteger(d.height)||d.width<1||d.height<1||d.width>65535||d.height>65535||!(d.data instanceof Uint8Array)||d.data.length<Math.ceil(d.width/8)*d.height){a=!1;break}if(l>=t||u>=n||l+d.width<=0||u+d.height<=0)continue;let f=Math.ceil(d.width/8);for(let i=Math.max(0,-u);i<Math.min(d.height,n-u);i++){if((o+=Math.min(d.width,t-l)-Math.max(0,-l))>s){a=!1;break}for(let n=Math.max(0,-l);n<Math.min(d.width,t-l);n++){if(!(d.data[i*f+(n>>3)]&128>>(n&7)))continue;let t=(u+i)*r+(l+n>>3),o=128>>(l+n&7);if(e.data[t]&o){a=!1;break}S[t]|=o}yield}for(let e=Math.max(0,Math.floor(u/$));e<Math.min(Math.ceil(n/$),Math.ceil((u+d.height)/$));e++)for(let t=Math.max(0,Math.floor(l/$));t<Math.min(i,Math.ceil((l+d.width)/$));t++){let n=C[e*i+t];n.length<=b_&&n.push(c)}}a||(C=void 0,S=e.data)}try{for(let n=0;n<c.length;n++){let a=c[n],s=n?4:o,l=Math.ceil(a.width/$),u=Math.ceil(a.height/$);for(let o=0;o<u;o++)for(let c=0;c<l;c++){let u=o*l+c,f=n===0?C?.[u]:void 0,p=!!f?.length&&f.length<=b_,h=n?_:g;if((c+1)*$<=a.width&&(o+1)*$<=a.height){if(s===1){let n=p?S:e.data,r=Math.ceil(t/8),i=o*$*r+c*4;for(let e=0;e<$;e++,i+=r)h[e]=x_[n[i]]|x_[n[i+1]]<<8|x_[n[i+2]]<<16|x_[n[i+3]]<<24}else{let e=n?r.data:i,l=n?a.rowBytes:t,u=$*s/8,d=(n?a.byteOffset:0)+o*$*l+c*u,f=0;for(let t=0;t<$;t++,d+=l)for(let t=0;t<u;t+=4){let n=d+t;h[f++]=s===4?S_[e[n]]|S_[e[n+1]]<<8|S_[e[n+2]]<<16|S_[e[n+3]]<<24:e[n]|e[n+1]<<8|e[n+2]<<16|e[n+3]<<24}}}else{h.fill(0);for(let l=0;l<$;l++)for(let u=0;u<$;u++){let d=Math.min(a.width-1,c*$+u),f=Math.min(a.height-1,o*$+l),m;m=n?r.data[a.byteOffset+f*a.rowBytes+(d>>1)]>>(d&1?0:4)&15:i?i[f*t+d]:(p?S:e.data)[f*Math.ceil(t/8)+(d>>3)]>>7-(d&7)&1;let g=(l*$+u)*s;h[g>>>5]|=m<<(g&31)}}let v=x(h,s);if(p&&T){let e=[v,f.length];for(let t of f){let n=T.placements[t+2],r=T.symbols[n],i=w.get(n);if(i===void 0){let e=new Uint32Array(2+Math.ceil(r.data.length/4));e[0]=r.width,e[1]=r.height;for(let t=0;t<r.data.length;t++)e[2+(t>>2)]|=r.data[t]<<(t&3)*8;i=m(e),w.set(n,i)}e.push(i,T.placements[t]>>>0,T.placements[t+1]>>>0)}v=(y_|m(e))>>>0,b++}d[d[5+n]+u]=v,yield}}let a=Math.min(Math.max(t,n),Math.ceil(Math.sqrt(f))),l=Math.ceil(f/a);if(a*l*4>=s*.95)return;let u=new Uint8Array(a*l*4),p=new DataView(u.buffer);for(let e=0;e<f;e++)p.setUint32(e*4,d[e],!0),e&4095||(yield);return{width:a,height:l,data:u,uniformBlocks:v,reusedBlocks:y,symbolBlocks:b}}catch(e){if(e!==w_)throw e}}var w_=Symbol(`compact texture is not smaller`);function T_(e,t,n,r,i){let a=ue(C_({...e,symbols:void 0},t,n,r,i));if(!e.symbols||i)return a;let o=ue(C_(e,t,n,r));return o&&(!a||o.data.length<a.data.length)?o:a}async function E_(e,t,n,r,i,a){let o=await le(C_({...e,symbols:void 0},t,n,r,i),a);if(!e.symbols||i)return o;let s=await le(C_(e,t,n,r),a);return s&&(!o||s.data.length<o.data.length)?s:o}var D_=`
  return smoothstep(-aaWorld, aaWorld, halfWidth - distanceValue)
    - smoothstep(-aaWorld, aaWorld, -halfWidth - distanceValue);
`,O_=`
float heprStrokeCoverage(float distanceValue, float halfWidth, float aaWorld) {
${D_}}
`,k_=`
fn heprStrokeCoverage(distanceValue: f32, halfWidth: f32, aaWorld: f32) -> f32 {
${D_}}
`,A_=`
  if (primitiveType >= 0.0) { return alpha; }
  return 1.0 - pow(1.0 - clamp(alpha, 0.0, 1.0), max(1.0, 1.0 - primitiveType));
`,j_=`
float heprStrokeLodAlpha(float alpha, float primitiveType) {
${A_}}
`,M_=`
fn heprStrokeLodAlpha(alpha: f32, primitiveType: f32) -> f32 {
${A_}}
`,N_=`
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



float heprQuadraticIntegral(vec2 a, vec2 b, vec2 c) {
  float dx = c.x - a.x;
  float dy = c.y - a.y;
  return (a.x + 0.5 * dx) * dy +
    ((b.x - a.x) * dy - (b.y - a.y) * dx) / 3.0;
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
  vec2 previous = heprQuadraticPoint(a, b, c, ts);
  previous.y = vStart;
  vec2 clippedEnd = heprQuadraticPoint(a, b, c, te);
  clippedEnd.y = vEnd;
  float startWeight = 1.0 - ts;
  float endWeight = 1.0 - te;
  float clippedBlend = startWeight * te + ts * endWeight;
  vec2 clippedControl = vec2(
    startWeight * endWeight * a.x + clippedBlend * b.x + ts * te * c.x,
    startWeight * endWeight * a.y + clippedBlend * b.y + ts * te * c.y
  );
  
  
  if (min(min(previous.x, clippedEnd.x), clippedControl.x) >= 0.0 &&
      max(max(previous.x, clippedEnd.x), clippedControl.x) <= 1.0) {
    return heprQuadraticIntegral(previous, clippedControl, clippedEnd);
  }
  float deviation = 0.25 * max(abs(a.x - 2.0 * b.x + c.x), abs(qa)) * span * span;
  int pieces = int(clamp(ceil(8.0 * sqrt(deviation)), 1.0, 8.0));
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
  
  if (min(min(a.x, b.x), c.x) >= 0.0 && max(max(a.x, b.x), c.x) <= 1.0 &&
      min(min(a.y, b.y), c.y) >= low && max(max(a.y, b.y), c.y) <= high) {
    return heprQuadraticIntegral(a, b, c);
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







float heprHullAreaWinding(float signedArea, vec2 lower, vec2 upper, vec4 box, vec2 footprint) {
  float spanX = upper.x - lower.x;
  float spanY = upper.y - lower.y;
  float overlapX = min(box.x + footprint.x, upper.x) - max(box.x, lower.x);
  float overlapY = min(box.y + footprint.y, upper.y) - max(box.y, lower.y);
  float shareX = overlapX >= spanX ? 1.0 : max(overlapX, 0.0) / max(spanX, 1e-30);
  float shareY = overlapY >= spanY ? 1.0 : max(overlapY, 0.0) / max(spanY, 1e-30);
  return signedArea * box.z * box.w * shareX * shareY;
}
`,P_=`
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



fn heprQuadraticIntegral(a: vec2<f32>, b: vec2<f32>, c: vec2<f32>) -> f32 {
  let dx = c.x - a.x;
  let dy = c.y - a.y;
  return (a.x + 0.5 * dx) * dy +
    ((b.x - a.x) * dy - (b.y - a.y) * dx) / 3.0;
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
  var previous = heprQuadraticPoint(a, b, c, ts);
  previous.y = vStart;
  var clippedEnd = heprQuadraticPoint(a, b, c, te);
  clippedEnd.y = vEnd;
  let startWeight = 1.0 - ts;
  let endWeight = 1.0 - te;
  let clippedBlend = startWeight * te + ts * endWeight;
  let clippedControl = vec2<f32>(
    startWeight * endWeight * a.x + clippedBlend * b.x + ts * te * c.x,
    startWeight * endWeight * a.y + clippedBlend * b.y + ts * te * c.y
  );
  
  
  if (min(min(previous.x, clippedEnd.x), clippedControl.x) >= 0.0 &&
      max(max(previous.x, clippedEnd.x), clippedControl.x) <= 1.0) {
    return heprQuadraticIntegral(previous, clippedControl, clippedEnd);
  }
  let deviation = 0.25 * max(abs(a.x - 2.0 * b.x + c.x), abs(qa)) * span * span;
  let pieces = i32(clamp(ceil(8.0 * sqrt(deviation)), 1.0, 8.0));
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
  
  if (min(min(a.x, b.x), c.x) >= 0.0 && max(max(a.x, b.x), c.x) <= 1.0 &&
      min(min(a.y, b.y), c.y) >= low && max(max(a.y, b.y), c.y) <= high) {
    return heprQuadraticIntegral(a, b, c);
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







fn heprHullAreaWinding(signedArea: f32, lower: vec2<f32>, upper: vec2<f32>, box: vec4<f32>, footprint: vec2<f32>) -> f32 {
  let spanX = upper.x - lower.x;
  let spanY = upper.y - lower.y;
  let overlapX = min(box.x + footprint.x, upper.x) - max(box.x, lower.x);
  let overlapY = min(box.y + footprint.y, upper.y) - max(box.y, lower.y);
  let shareX = select(max(overlapX, 0.0) / max(spanX, 1e-30), 1.0, overlapX >= spanX);
  let shareY = select(max(overlapY, 0.0) / max(spanY, 1e-30), 1.0, overlapY >= spanY);
  return signedArea * box.z * box.w * shareX * shareY;
}
`,F_=`
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
`,I_=`
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
`,L_=`
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
`,R_=`
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
`,z_=`
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
`,B_=`
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
`,V_=`
fn heprFillCellInfo(pathIndex: f32, headers: f32, segments: texture_2d<f32>) -> vec4<f32> {
  if (headers <= 0.0) { return vec4<f32>(0.0); }
  let width = i32(textureDimensions(segments).x);
  let index = i32(headers - 1.0 + pathIndex);
  return textureLoad(segments, vec2<i32>(index % width, index / width), 0);
}
`,H_=`
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

float heprVectorClip(vec2 point) {
  highp int index = int(uVectorClipIndex);
  
  while (index >= 0) {
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
      for (highp int piece = 0; piece < int(cell.y); piece++) {
        vec4 line = heprClipTexel(int(cell.x) + piece);
        if ((line.y > point.y) != (line.w > point.y)) {
          float x = line.x + (point.y - line.y) / (line.w - line.y) * (line.z - line.x);
          if (x > point.x) winding += line.w > line.y ? 1 : -1;
        }
      }
      for (highp int closure = 0; closure < int(cell.w); closure++) {
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
      for (highp int edge = 0; edge < edgeCount; edge++) {
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
  return 1.0;
}


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
  for (highp int edge = 0; edge < count; edge += 4) {
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
        for (highp int closure = 0; closure < closureCount; closure += 2) {
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
  while (index >= 0) {
    vec4 node = heprClipTexel(index);
    samples &= node.z < 0.0 ? heprClipRectSamples(heprClipTexel(int(node.y)), sampleX, sampleY)
      : heprClipPolygonSamples(node, sampleX, sampleY, span);
    if (samples == 0u) return 0.0;
    index = int(node.x);
  }
  return heprSampleCoverage(samples);
}
`,U_=`
fn heprVectorClip(point: vec2<f32>, clipIndex: f32, clipTexture: texture_2d<f32>) -> f32 {
  var index = i32(clipIndex);
  
  while (index >= 0) {
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
  return 1.0;
}

fn heprClipTexel(clipTexture: texture_2d<f32>, index: i32) -> vec4<f32> {
  let width = i32(textureDimensions(clipTexture).x);
  return textureLoad(clipTexture, vec2<i32>(index % width, index / width), 0);
}
`,W_=`
fn heprVectorClipAA(point: vec2<f32>, clipIndex: f32, clipTexture: texture_2d<f32>, aaWidth: f32) -> f32 {
  
  let offsets = vec4<f32>(-0.375, -0.125, 0.125, 0.375);
  let sampleX = point.x + offsets * aaWidth;
  let sampleY = point.y + offsets * aaWidth;
  let span = 0.75 * aaWidth;
  var samples = 0xFFFFu;
  var index = i32(clipIndex);
  while (index >= 0) {
    let node = heprClipTexel(clipTexture, index);
    if (node.z < 0.0) {
      samples &= heprClipRectSamples(heprClipTexel(clipTexture, i32(node.y)), sampleX, sampleY);
    } else {
      samples &= heprClipPolygonSamples(clipTexture, node, sampleX, sampleY, span);
    }
    if (samples == 0u) { return 0.0; }
    index = i32(node.x);
  }
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
`+U_,G_=`flat in float vVectorClipIndex;
`+H_.replaceAll(`int(uVectorClipIndex)`,`int(uVectorClipIndex < -1.5 ? vVectorClipIndex : uVectorClipIndex)`),K_=`
uint heprRasterClipRectSamples(vec4 bounds, vec2 point) {
  bool inside = point.x >= bounds.x && point.y >= bounds.y && point.x < bounds.z && point.y < bounds.w;
  return inside ? 0xFFFFu : 0u;
}
`+H_.replace(`heprClipRectSamples(heprClipTexel(int(node.y)), sampleX, sampleY)`,`heprRasterClipRectSamples(heprClipTexel(int(node.y)), point)`).replace(`heprClipPolygonSamples(node, sampleX, sampleY, span);`,`heprRasterClipPolygonSamples(node, point, sampleX, sampleY, span);`).replace(`float heprVectorClipAA(vec2 point, float aaWidth)`,`
uint heprRasterClipPolygonSamples(vec4 node, vec2 point, vec4 sampleX, vec4 sampleY, float span) {
  bool tileRect = node.z == 4.0 && (int(node.w) & 6) == 0;
  if (tileRect) {
    for (int edge = 0; edge < 4; edge++) {
      vec4 line = heprClipTexel(int(node.y) + edge);
      tileRect = tileRect && min(abs(line.x - line.z), abs(line.y - line.w)) <= 0.002;
    }
  }
  if (tileRect) {
    sampleX = vec4(point.x);
    sampleY = vec4(point.y);
    span = 0.0;
  }
  return heprClipPolygonSamples(node, sampleX, sampleY, span);
}
float heprVectorClipAA(vec2 point, float aaWidth)`),q_=W_.replace(`heprClipRectSamples(heprClipTexel(clipTexture, i32(node.y)), sampleX, sampleY)`,`heprRasterClipRectSamples(heprClipTexel(clipTexture, i32(node.y)), point)`).replace(`heprClipPolygonSamples(clipTexture, node, sampleX, sampleY, span);`,`heprRasterClipPolygonSamples(clipTexture, node, point, sampleX, sampleY, span);`)+`
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
`,J_=`
vec4 heprThreeEncodeOutputColor(vec4 color) {
  
  
  return color;
}

float heprThreeLinearCoverageToOutputAlpha(float coverage) {
  return clamp(coverage, 0.0, 1.0);
}
`,Y_=`#version 300 es
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
  int index = int(aSegmentIndex);
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
`,X_=`#version 300 es
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

${J_}

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

${G_}
${O_}
${j_}

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
`,Z_=`#version 300 es
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


uniform int uFillClipBoundsEnabled;
uniform highp sampler2D uFillClipBoundsTex;
uniform float uFillAAScreenPx;
uniform float uVectorClipIndex;
uniform vec2 uViewport;
uniform vec2 uCameraCenter;
uniform float uZoom;
uniform float uUseLocalToClip;
uniform mat4 uLocalToClip;

flat out int vSegmentStart;
flat out int vSegmentCount;
flat out int vFillPathIndex;
flat out vec2 vFillOrigin;
flat out vec2 vFillBoundsMax;
flat out float vFillSignedArea;
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

${F_}

vec4 heprFillInstanceClipBounds(float instanceClipIndex) {
  
  vec4 bounds = vec4(-1e38, -1e38, 1e38, 1e38);
  int clipIndex = int(uVectorClipIndex < -1.5 ? instanceClipIndex : uVectorClipIndex);
  
  
  if (uUseLocalToClip < 0.5 && uFillClipBoundsEnabled > 0 && clipIndex >= 0) {
    bounds = texelFetch(uFillClipBoundsTex,
      coordFromIndex(clipIndex, textureSize(uFillClipBoundsTex, 0)), 0);
  }
  return bounds;
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
  vFillPathIndex = 0;
  vFillOrigin = vec2(0.0);
  vFillBoundsMax = vec2(0.0);
  vFillSignedArea = 0.0;
  vColor = vec3(0.0);
  vAlpha = 0.0;
  vFillRule = 0.0;
  vFillHasCompanionStroke = 0.0;
  vLocal = vec2(0.0);
}

void main() {
  vVectorClipIndex = aVectorClipIndex - 1.0;
  int pathIndex = int(aFillPathIndex);
  vec4 metaA = texelFetch(uFillPathMetaTexA, coordFromIndex(pathIndex, uFillPathMetaTexSize), 0);
  vec4 metaB = texelFetch(uFillPathMetaTexB, coordFromIndex(pathIndex, uFillPathMetaTexSize), 0);
  vec4 metaC = texelFetch(uFillPathMetaTexC, coordFromIndex(pathIndex, uFillPathMetaTexSize), 0);

  int segmentCount = int(metaA.y);
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
  
  
  
  if (uUseLocalToClip < 0.5 && metaC.x >= 0.0) {
    margin = max(margin * (0.5 * uFillAAScreenPx), vec2(5e-5)) +
      vec2(1e-5 / max(uZoom, 1e-4));
  }
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

  vSegmentStart = int(metaA.x);
  vSegmentCount = segmentCount;
  vFillPathIndex = pathIndex;
  vFillOrigin = minBounds;
  vFillBoundsMax = maxBounds;
  vFillSignedArea = metaC.y;
  vColor = vec3(metaB.z, metaB.w, metaC.z);
  vAlpha = alpha;
  vFillRule = metaC.x;
  vFillHasCompanionStroke = metaC.y;
  vLocal = world;
}
`,Q_=`#version 300 es
precision highp float;



precision highp int;
precision highp sampler2D;

uniform sampler2D uFillSegmentTexA;
uniform sampler2D uFillSegmentTexB;
uniform ivec2 uFillSegmentTexSize;
uniform float uFillAAScreenPx;
uniform vec4 uVectorOverride;
uniform int uFillBandEntries;


uniform int uFillBandBase;
uniform int uFillCellHeaders;

flat in int vSegmentStart;
flat in int vSegmentCount;
flat in int vFillPathIndex;
flat in vec2 vFillOrigin;
flat in vec2 vFillBoundsMax;
flat in float vFillSignedArea;
flat in vec3 vColor;
flat in float vAlpha;
flat in float vFillRule;
in vec2 vLocal;

out vec4 outColor;

${J_}

const float FILL_PRIMITIVE_QUADRATIC = 1.0;

ivec2 coordFromIndex(int index, ivec2 sizeValue) {
  int x = index % sizeValue.x;
  int y = index / sizeValue.x;
  return ivec2(x, y);
}

${N_}

vec4 heprCellFetchA(int index) {
  return texelFetch(uFillSegmentTexA, coordFromIndex(index, uFillSegmentTexSize), 0);
}

vec4 heprCellFetchB(int index) {
  return texelFetch(uFillSegmentTexB, coordFromIndex(index, uFillSegmentTexSize), 0);
}

${z_}

${G_}



float heprFillIndexedWinding(int pathIndex, int segmentStart, int segmentCount,
    vec2 origin, vec4 box, vec2 footprint) {
  vec4 vFillCells = vec4(0.0);
  vec4 vFillBands = vec4(0.0);
  if (segmentCount >= 24) {
    if (uFillCellHeaders > 0) {
      vFillCells = texelFetch(uFillSegmentTexA,
        coordFromIndex(uFillCellHeaders - 1 + pathIndex, uFillSegmentTexSize), 0);
    }
    if (vFillCells.y <= 0.0 && uFillBandBase >= 0) {
      vFillBands = texelFetch(uFillSegmentTexA,
        coordFromIndex(uFillBandBase + pathIndex, uFillSegmentTexSize), 0);
    }
  }
  
  
  float winding = 0.0;
  if (vFillCells.y > 0.0) {
    winding = heprCellWinding(vFillCells, origin, box, footprint);
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
      int count = segmentCount;
      int entry = 0;
      if (bandCount > 0) {
        vec4 range = texelFetch(uFillSegmentTexA,
          coordFromIndex(int(vFillBands.x) + band, uFillSegmentTexSize), 0);
        entry = int(range.x);
        count = int(range.y);
      }
      vec2 rows = heprBandRows(vFillBands, band, bandCount, box);
      for (int i = 0; i < count; i += 1) {
        int segment = segmentStart + i;
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
  return winding;
}

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
  
  
  
  
  if (vFillRule >= 0.0 && all(lessThanEqual(vFillBoundsMax - vFillOrigin, footprint))) {
    winding = heprHullAreaWinding(vFillSignedArea, vFillOrigin, vFillBoundsMax, box, footprint);
  } else {
    winding = heprFillIndexedWinding(vFillPathIndex, vSegmentStart, vSegmentCount, vFillOrigin, box, footprint);
  }

  vec3 color = mix(vColor, uVectorOverride.rgb, clamp(uVectorOverride.a, 0.0, 1.0));
  
  
  float fillRule = vFillRule < 0.0 ? -vFillRule - 1.0 : vFillRule;
  float coverage = heprFillCoverage(winding, fillRule >= 0.5);
  float alpha = heprThreeLinearCoverageToOutputAlpha(coverage) * vAlpha;
  if (alpha <= 0.001) {
    discard;
  }

  outColor = heprThreeEncodeOutputColor(vec4(color, alpha));
  outColor *= heprVectorClip(vLocal);
}
`,$_=`#version 300 es
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

${F_}

void main() {
  vVectorClipIndex = aVectorClipIndex - 1.0;
  int instanceIndex = int(aTextInstanceIndex);
  vec4 instanceA = texelFetch(uTextInstanceTexA, coordFromIndex(instanceIndex, uTextInstanceTexSize), 0);
  vec4 instanceB = texelFetch(uTextInstanceTexB, coordFromIndex(instanceIndex, uTextInstanceTexSize), 0);
  vec4 instanceC = texelFetch(uTextInstanceTexC, coordFromIndex(instanceIndex, uTextInstanceTexSize), 0);

  int glyphIndex = int(instanceB.z);
  vec4 glyphMetaA = texelFetch(uTextGlyphMetaTexA, coordFromIndex(glyphIndex, uTextGlyphMetaTexSize), 0);
  vec4 glyphMetaB = texelFetch(uTextGlyphMetaTexB, coordFromIndex(glyphIndex, uTextGlyphMetaTexSize), 0);

  int segmentCount = int(glyphMetaA.y);
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
  int clipRef = int(instanceB.w);
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
  vSegmentStart = int(glyphMetaA.x);
  vSegmentCount = segmentCount;
  vColor = instanceC.rgb;
  vColorAlpha = instanceC.a;
  vRasterRect = glyphRasterMeta;
  vInkDensity = glyphMetaB.z;
  
  vNormCoord = (local - minBounds) / max(maxBounds - minBounds, vec2(1e-6));
  vLocal = local;
  vWorld = world;
}
`,ev=`#version 300 es
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

${J_}

const float TEXT_PRIMITIVE_QUADRATIC = 1.0;

ivec2 coordFromIndex(int index, ivec2 sizeValue) {
  int x = index % sizeValue.x;
  int y = index / sizeValue.x;
  return ivec2(x, y);
}

${N_}

${G_}

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
`,tv=`#version 300 es
precision highp float;

layout(location = 0) in vec2 aCorner;

void main() {
  gl_Position = vec4(aCorner, 0.0, 1.0);
}
`,nv=`#version 300 es
precision highp float;

uniform sampler2D uVectorLayerTex;
uniform vec2 uViewportPx;

out vec4 outColor;

void main() {
  vec2 uv = gl_FragCoord.xy / max(uViewportPx, vec2(1.0));
  outColor = texture(uVectorLayerTex, clamp(uv, vec2(0.0), vec2(1.0)));
}
`,rv=`#version 300 es
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
`,iv=`#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uRasterTex;
uniform float uRasterOpacity;
in vec2 vUv;
in vec2 vWorld;
out vec4 outColor;

${K_}

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
`,av=`#version 300 es
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
`,ov=`#version 300 es
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
`;async function sv(e,t,n){n?.throwIfAborted();let r=e.monochrome;if(!r){let r=await Me(e,t,n);return n?.throwIfAborted(),{plan:t,pixels:r}}let i=[],a=[],o=[],s=[];if(t.width===e.width&&t.height===e.height){for(let i of t.tiles){n?.throwIfAborted();let t=se(r,e.width,e.height,i);a.push(t);let c=await pe(t,i.width,i.height,n);o.push(c),s.push(await E_(t,i.width,i.height,c,void 0,n))}return n?.throwIfAborted(),{plan:t,pixels:i,monochromeTiles:a,coverageAtlases:o,compactAtlases:s}}let c=await fe(r,e.width,e.height,t.width,t.height,n);for(let e of t.tiles){n?.throwIfAborted();let a=c;if(e.width!==t.width||e.height!==t.height){a=new Uint8Array(e.width*e.height);for(let r=0;r<e.height;r++){n?.throwIfAborted();let i=(e.y+r)*t.width+e.x;a.set(c.subarray(i,i+e.width),r*e.width)}}i.push(a);let l=await ce(a,e.width,e.height,n);o.push(l),s.push(await E_(r,e.width,e.height,l,a,n))}return n?.throwIfAborted(),{plan:t,pixels:i,coverageAtlases:o,compactAtlases:s}}var cv=`
fn heprCompactWord(image: texture_2d<f32>, offset: u32) -> u32 {
  let width = textureDimensions(image).x;
  let bytes = vec4u(round(textureLoad(image, vec2i(i32(offset % width), i32(offset / width)), 0) * 255.0));
  return bytes.r | (bytes.g << 8u) | (bytes.b << 16u) | (bytes.a << 24u);
}`,lv=`
fn heprCompactBlock(image: texture_2d<f32>, entry: u32, pixel: vec2u, bits: u32) -> f32 {
  if ((entry & 0x80000000u) != 0u) { return f32(entry & 255u); }
  let bit = ((pixel.y & 31u) * 32u + (pixel.x & 31u)) * bits;
  return f32((heprCompactWord(image, entry + bit / 32u) >> (bit & 31u)) & ((1u << bits) - 1u));
}`,uv=`
fn heprCompactTexel(image: texture_2d<f32>, size: vec2i, level: u32, pixel: vec2i) -> f32 {
  let p = vec2u(clamp(pixel, vec2i(0), size - vec2i(1)));
  let bits = select(4u, heprCompactWord(image, 4u), level == 0u);
  let map = heprCompactWord(image, 5u + level);
  let entry = heprCompactWord(image, map + (p.y / 32u) * ((u32(size.x) + 31u) / 32u) + p.x / 32u);
  if ((entry & 0xc0000000u) != 0x40000000u) {
    return heprCompactBlock(image, entry, p, bits) / f32((1u << bits) - 1u);
  }
  let list = entry & 0x3fffffffu;
  var value = heprCompactBlock(image, heprCompactWord(image, list), p, 1u);
  let count = heprCompactWord(image, list + 1u);
  for (var i = 0u; i < 8u; i++) {
    if (i >= count) { break; }
    let record = list + 2u + 3u * i;
    let glyph = heprCompactWord(image, record);
    let origin = vec2i(bitcast<i32>(heprCompactWord(image, record + 1u)), bitcast<i32>(heprCompactWord(image, record + 2u)));
    let local = vec2i(p) - origin;
    let glyphSize = vec2i(i32(heprCompactWord(image, glyph)), i32(heprCompactWord(image, glyph + 1u)));
    if (all(local >= vec2i(0)) && all(local < glyphSize)) {
      let byte = u32(local.y) * ((u32(glyphSize.x) + 7u) / 8u) + u32(local.x) / 8u;
      let word = heprCompactWord(image, glyph + 2u + byte / 4u);
      let ink = (word >> ((byte & 3u) * 8u + 7u - (u32(local.x) & 7u))) & 1u;
      value = min(value, 1.0 - f32(ink));
    }
  }
  return value;
}`,dv=`
fn heprCompactBilinear(image: texture_2d<f32>, size: vec2i, level: u32, uv: vec2f) -> f32 {
  let position = uv * vec2f(size) - vec2f(0.5);
  let pixel = vec2i(floor(position)); let weight = fract(position);
  return mix(mix(heprCompactTexel(image, size, level, pixel), heprCompactTexel(image, size, level, pixel + vec2i(1,0)), weight.x),
    mix(heprCompactTexel(image, size, level, pixel + vec2i(0,1)), heprCompactTexel(image, size, level, pixel + vec2i(1,1)), weight.x), weight.y);
}`,fv=`
fn heprCompactSample(image: texture_2d<f32>, baseSize: vec2i, uv: vec2f, lod: f32) -> f32 {
  let bounded = clamp(lod, 0.0, f32(heprCompactWord(image, 2u) - 1u));
  let level = u32(floor(bounded)); var size = baseSize;
  for (var i = 0u; i < 32u; i++) { if (i >= level) { break; } size = max(size / 2, vec2i(1)); }
  let first = heprCompactBilinear(image, size, level, uv);
  let next = min(level + 1u, heprCompactWord(image, 2u) - 1u);
  return mix(first, heprCompactBilinear(image, max(size / 2, vec2i(1)), next, uv), fract(bounded));
}`,pv=[cv,lv,uv,dv,fv].join(`
`),mv=`
uint heprCompactWord(sampler2D image, uint offset) {
  uint width = uint(textureSize(image, 0).x);
  uvec4 bytes = uvec4(round(texelFetch(image, ivec2(offset % width, offset / width), 0) * 255.0));
  return bytes.r | (bytes.g << 8u) | (bytes.b << 16u) | (bytes.a << 24u);
}
float heprCompactBlock(sampler2D image, uint entry, uvec2 pixel, uint bits) {
  if ((entry & 0x80000000u) != 0u) return float(entry & 255u);
  uint bit = ((pixel.y & 31u) * 32u + (pixel.x & 31u)) * bits;
  return float((heprCompactWord(image, entry + bit / 32u) >> (bit & 31u)) & ((1u << bits) - 1u));
}
float heprCompactTexel(sampler2D image, ivec2 size, uint level, ivec2 pixel) {
  uvec2 p = uvec2(clamp(pixel, ivec2(0), size - 1));
  uint bits = level == 0u ? heprCompactWord(image, 4u) : 4u;
  uint map = heprCompactWord(image, 5u + level);
  uint entry = heprCompactWord(image, map + (p.y / 32u) * ((uint(size.x) + 31u) / 32u) + p.x / 32u);
  float value = 0.0;
  if ((entry & 0xc0000000u) != 0x40000000u) {
    value = heprCompactBlock(image, entry, p, bits) / float((1u << bits) - 1u);
  } else {
    uint list = entry & 0x3fffffffu;
    value = heprCompactBlock(image, heprCompactWord(image, list), p, 1u);
    uint count = heprCompactWord(image, list + 1u);
    for (uint i = 0u; i < 8u; i++) {
      if (i >= count) break;
      uint record = list + 2u + 3u * i;
      uint glyph = heprCompactWord(image, record);
      ivec2 local = ivec2(p) - ivec2(int(heprCompactWord(image, record + 1u)), int(heprCompactWord(image, record + 2u)));
      ivec2 glyphSize = ivec2(heprCompactWord(image, glyph), heprCompactWord(image, glyph + 1u));
      if (all(greaterThanEqual(local, ivec2(0))) && all(lessThan(local, glyphSize))) {
        uint byteOffset = uint(local.y) * ((uint(glyphSize.x) + 7u) / 8u) + uint(local.x) / 8u;
        uint word = heprCompactWord(image, glyph + 2u + byteOffset / 4u);
        uint ink = (word >> ((byteOffset & 3u) * 8u + 7u - (uint(local.x) & 7u))) & 1u;
        value = min(value, 1.0 - float(ink));
      }
    }
  }
  return value;
}
float heprCompactBilinear(sampler2D image, ivec2 size, uint level, vec2 uv) {
  vec2 position = uv * vec2(size) - 0.5;
  ivec2 pixel = ivec2(floor(position)); vec2 weight = fract(position);
  return mix(mix(heprCompactTexel(image, size, level, pixel), heprCompactTexel(image, size, level, pixel + ivec2(1,0)), weight.x),
    mix(heprCompactTexel(image, size, level, pixel + ivec2(0,1)), heprCompactTexel(image, size, level, pixel + ivec2(1,1)), weight.x), weight.y);
}
float heprCompactSample(sampler2D image, ivec2 baseSize, vec2 uv, float lod) {
  float bounded = clamp(lod, 0.0, float(heprCompactWord(image, 2u) - 1u));
  uint level = uint(floor(bounded)); ivec2 size = baseSize;
  for (uint i = 0u; i < 32u; i++) { if (i >= level) break; size = max(size / 2, ivec2(1)); }
  float first = heprCompactBilinear(image, size, level, uv);
  uint next = min(level + 1u, heprCompactWord(image, 2u) - 1u);
  return mix(first, heprCompactBilinear(image, max(size / 2, ivec2(1)), next, uv), fract(bounded));
}`,hv=`
float heprCoverageTexel(sampler2D image, ivec2 size, int offset, ivec2 pixel) {
  ivec2 p = clamp(pixel, ivec2(0), size - 1);
  int index = offset + p.y * ((size.x + 1) / 2) + p.x / 2;
  int atlasWidth = textureSize(image, 0).x;
  uint packed = uint(round(texelFetch(image, ivec2(index % atlasWidth, index / atlasWidth), 0).r * 255.0));
  return float((packed >> uint((p.x & 1) == 0 ? 4 : 0)) & 15u) / 15.0;
}

float heprCoverageBilinear(sampler2D image, ivec2 size, int offset, vec2 uv) {
  vec2 position = uv * vec2(size) - 0.5;
  ivec2 pixel = ivec2(floor(position));
  vec2 weight = fract(position);
  return mix(mix(heprCoverageTexel(image, size, offset, pixel),
    heprCoverageTexel(image, size, offset, pixel + ivec2(1, 0)), weight.x),
    mix(heprCoverageTexel(image, size, offset, pixel + ivec2(0, 1)),
    heprCoverageTexel(image, size, offset, pixel + ivec2(1, 1)), weight.x), weight.y);
}

float heprPackedCoverage(sampler2D image, ivec2 baseSize, vec2 uv, float lod) {
  float level = clamp(lod, 0.0, max(0.0, floor(log2(float(max(baseSize.x, baseSize.y)))) - 1.0));
  int target = int(floor(level));
  ivec2 size = max(ivec2(1), baseSize / 2);
  int offset = 0;
  for (int i = 0; i < 32; i++) {
    if (i == target) {
      float first = heprCoverageBilinear(image, size, offset, uv);
      float fraction = fract(level);
      if (fraction == 0.0) return first;
      offset += ((size.x + 1) / 2) * size.y;
      size = max(ivec2(1), size / 2);
      return mix(first, heprCoverageBilinear(image, size, offset, uv), fraction);
    }
    offset += ((size.x + 1) / 2) * size.y;
    size = max(ivec2(1), size / 2);
  }
  return 0.0;
}
`,gv=`
fn heprCoverageTexel(image: texture_2d<f32>, size: vec2i, offset: i32, pixel: vec2i) -> f32 {
  let p = clamp(pixel, vec2i(0), size - vec2i(1));
  let index = offset + p.y * ((size.x + 1) / 2) + p.x / 2;
  let atlasWidth = i32(textureDimensions(image).x);
  let packed = u32(round(textureLoad(image, vec2i(index % atlasWidth, index / atlasWidth), 0).r * 255.0));
  let shift = select(0u, 4u, (u32(p.x) & 1u) == 0u);
  return f32((packed >> shift) & 15u) / 15.0;
}`,_v=`
fn heprCoverageBilinear(image: texture_2d<f32>, size: vec2i, offset: i32, uv: vec2f) -> f32 {
  let position = uv * vec2f(size) - vec2f(0.5);
  let pixel = vec2i(floor(position));
  let weight = fract(position);
  return mix(mix(heprCoverageTexel(image, size, offset, pixel),
    heprCoverageTexel(image, size, offset, pixel + vec2i(1, 0)), weight.x),
    mix(heprCoverageTexel(image, size, offset, pixel + vec2i(0, 1)),
    heprCoverageTexel(image, size, offset, pixel + vec2i(1, 1)), weight.x), weight.y);
}`,vv=`
fn heprPackedCoverage(image: texture_2d<f32>, baseSize: vec2i, uv: vec2f, lod: f32) -> f32 {
  let level = clamp(lod, 0.0, max(0.0, floor(log2(f32(max(baseSize.x, baseSize.y)))) - 1.0));
  let targetLevel = i32(floor(level));
  var size = max(vec2i(1), baseSize / vec2i(2));
  var offset = 0;
  for (var i = 0; i < 32; i++) {
    if (i == targetLevel) {
      let first = heprCoverageBilinear(image, size, offset, uv);
      let fraction = fract(level);
      if (fraction == 0.0) { return first; }
      offset += ((size.x + 1) / 2) * size.y;
      size = max(vec2i(1), size / vec2i(2));
      return mix(first, heprCoverageBilinear(image, size, offset, uv), fraction);
    }
    offset += ((size.x + 1) / 2) * size.y;
    size = max(vec2i(1), size / vec2i(2));
  }
  return 0.0;
}`,yv=gv+_v+vv;function bv(e){return e.replace(`precision highp float;`,`precision highp float;
precision highp int;`).replace(`uniform sampler2D uRasterTex;`,`uniform sampler2D uRasterTex;
uniform sampler2D uRasterMonoMips;
uniform float uRasterMonochrome;
uniform float uRasterOpaque;
uniform vec2 uRasterMonoSize;
uniform vec4 uRasterMonoColor0;
uniform vec4 uRasterMonoColor1;
${hv}
${mv}

float heprRasterBit(ivec2 pixel) {
  pixel = clamp(pixel, ivec2(0), ivec2(uRasterMonoSize) - 1);
  uint packed = uint(round(texelFetch(uRasterTex, ivec2(pixel.x >> 3, pixel.y), 0).r * 255.0));
  return float((packed >> uint(7 - (pixel.x & 7))) & 1u);
}

float heprRasterBinaryLinear(vec2 uv) {
  vec2 pixel = uv * uRasterMonoSize - 0.5;
  ivec2 corner = ivec2(floor(pixel));
  vec2 weight = fract(pixel);
  return mix(mix(heprRasterBit(corner), heprRasterBit(corner + ivec2(1, 0)), weight.x),
    mix(heprRasterBit(corner + ivec2(0, 1)), heprRasterBit(corner + ivec2(1, 1)), weight.x), weight.y);
}

vec4 heprRasterColor(vec2 uv, vec2 uvDx, vec2 uvDy) {
  vec4 color = vec4(0.0);
  if (uRasterMonochrome < 0.5) {
    if (uRasterMonochrome < -0.5) {
      ivec2 size = textureSize(uRasterTex, 0);
      color = texelFetch(uRasterTex, clamp(ivec2(floor(uv * vec2(size))), ivec2(0), size - 1), 0);
    } else color = textureGrad(uRasterTex, uv, uvDx, uvDy);
    if (uRasterOpaque > 0.5) color.a = 1.0;
  } else {
    float footprint = max(length(uvDx * uRasterMonoSize), length(uvDy * uRasterMonoSize));
    float lod = max(0.0, log2(max(footprint, 1.0)));
    float coverage = 0.0;
    if (uRasterMonochrome > 4.5) {
      ivec2 pixel = clamp(ivec2(floor(uv * uRasterMonoSize)), ivec2(0), ivec2(uRasterMonoSize) - 1);
      coverage = texelFetch(uRasterTex, pixel, 0).r;
    } else if (uRasterMonochrome > 3.5) {
      coverage = heprRasterBit(ivec2(floor(uv * uRasterMonoSize)));
    } else if (uRasterMonochrome > 2.5) {
      coverage = heprCompactSample(uRasterTex, ivec2(uRasterMonoSize), uv, lod);
    } else if (lod < 1.0) {
      float base = uRasterMonochrome > 1.5 ? textureLod(uRasterTex, uv, 0.0).r : heprRasterBinaryLinear(uv);
      coverage = mix(base, heprPackedCoverage(uRasterMonoMips, ivec2(uRasterMonoSize), uv, 0.0), lod);
    } else {
      coverage = heprPackedCoverage(uRasterMonoMips, ivec2(uRasterMonoSize), uv, lod - 1.0);
    }
    color = mix(uRasterMonoColor0, uRasterMonoColor1, coverage);
  }
  return color;
}`).replace(`texture(uRasterTex, vUv)`,`heprRasterColor(vUv, dFdx(vUv), dFdy(vUv))`)}function xv(){try{return!globalThis.matchMedia?.(`(prefers-reduced-motion: reduce)`).matches}catch{return!0}}function Sv(e=performance.now()){return xv()?e/1e3%2.4:1.2}function Cv(e,t){if(!e.pendingPagePreviews||!(t.width>0&&t.height>0&&t.zoom>0))return!1;let n=e.pageRects;for(let r=0;r<e.pendingPagePreviews.length;r++){if(!e.pendingPagePreviews[r])continue;let i=r*4,a=t.projection?t.projection(r):t.localToClip;if(a===null)continue;if(!a){let e=t.width/t.zoom/2,r=t.height/t.zoom/2;if(Math.max(n[i],n[i+2])>=t.cameraCenterX-e&&Math.min(n[i],n[i+2])<=t.cameraCenterX+e&&Math.max(n[i+1],n[i+3])>=t.cameraCenterY-r&&Math.min(n[i+1],n[i+3])<=t.cameraCenterY+r)return!0;continue}let o=1/0,s=1/0,c=1/0,l=-1/0,u=-1/0,d=-1/0,f=0;for(let[e,t]of[[n[i],n[i+1]],[n[i+2],n[i+1]],[n[i],n[i+3]],[n[i+2],n[i+3]]]){let n=a[3]*e+a[7]*t+a[15];if(!(n>1e-8))continue;f++;let r=(a[0]*e+a[4]*t+a[12])/n,i=(a[1]*e+a[5]*t+a[13])/n,p=(a[2]*e+a[6]*t+a[14])/n;o=Math.min(o,r),l=Math.max(l,r),s=Math.min(s,i),u=Math.max(u,i),c=Math.min(c,p),d=Math.max(d,p)}if(f&&(f<4||l>=-1&&o<=1&&u>=-1&&s<=1&&d>=(t.clipDepth??-1)&&c<=1))return!0}return!1}var wv=`
float heprPlaceholderBar(vec2 uv, vec2 center, vec2 halfSize) {
  vec2 d = abs(uv - center) - halfSize + vec2(0.003);
  return length(max(d, vec2(0.0))) + min(max(d.x,d.y),0.0) - 0.003;
}
vec4 heprPagePlaceholder(vec4 paper, vec2 uv, float pending, float time) {
  float aa = max(max(length(vec2(dFdx(uv.x),dFdy(uv.x))),
    length(vec2(dFdx(uv.y),dFdy(uv.y)))), 1e-6);
  if (pending < 0.5) return paper;
  float distance = min(heprPlaceholderBar(uv,vec2(0.35,0.14),vec2(0.23,0.009)),
    heprPlaceholderBar(uv,vec2(0.27,0.185),vec2(0.15,0.004)));
  float row = floor((uv.y - 0.27)/0.028);
  if (row >= 0.0 && row < 18.0 && mod(row,6.0) < 5.0) {
    float end = mod(row,6.0) > 3.5 ? 0.64 : 0.88 - mod(row,3.0)*0.055;
    distance = min(distance,heprPlaceholderBar(uv,vec2((0.12+end)*0.5,0.27+(row+0.5)*0.028),
      vec2((end-0.12)*0.5,0.004)));
  }
  distance = min(distance,heprPlaceholderBar(uv,vec2(0.5,0.915),vec2(0.025,0.003)));
  float mask = 1.0 - smoothstep(-aa,aa,distance);
  float highlight = 1.0 - smoothstep(0.0,0.22,abs(uv.x+uv.y*0.25-(time/2.4*1.8-0.4)));
  float luminance = dot(paper.rgb,vec3(0.2126,0.7152,0.0722));
  vec3 ink = vec3(luminance < paper.a*0.4 ? paper.a : 0.0);
  return vec4(mix(paper.rgb,ink,mask*mix(0.16,0.065,highlight)),paper.a);
}`,Tv=`
fn heprPlaceholderBar(uv: vec2f, center: vec2f, halfSize: vec2f) -> f32 {
  let d = abs(uv - center) - halfSize + vec2f(0.003);
  return length(max(d,vec2f(0.0))) + min(max(d.x,d.y),0.0) - 0.003;
}`,Ev=`
fn heprPagePlaceholder(paper: vec4f, uv: vec2f, pending: f32, time: f32) -> vec4f {
  let aa = max(max(length(vec2f(dpdx(uv.x),dpdy(uv.x))),
    length(vec2f(dpdx(uv.y),dpdy(uv.y)))),1e-6);
  if (pending < 0.5) { return paper; }
  var distance = min(heprPlaceholderBar(uv,vec2f(0.35,0.14),vec2f(0.23,0.009)),
    heprPlaceholderBar(uv,vec2f(0.27,0.185),vec2f(0.15,0.004)));
  let row = floor((uv.y - 0.27)/0.028);
  if (row >= 0.0 && row < 18.0 && row % 6.0 < 5.0) {
    let end = select(0.88 - (row % 3.0)*0.055,0.64,row % 6.0 > 3.5);
    distance = min(distance,heprPlaceholderBar(uv,vec2f((0.12+end)*0.5,0.27+(row+0.5)*0.028),
      vec2f((end-0.12)*0.5,0.004)));
  }
  distance = min(distance,heprPlaceholderBar(uv,vec2f(0.5,0.915),vec2f(0.025,0.003)));
  let mask = 1.0 - smoothstep(-aa,aa,distance);
  let highlight = 1.0 - smoothstep(0.0,0.22,abs(uv.x+uv.y*0.25-(time/2.4*1.8-0.4)));
  let luminance = dot(paper.rgb,vec3f(0.2126,0.7152,0.0722));
  let ink = vec3f(select(0.0,paper.a,luminance < paper.a*0.4));
  return vec4f(mix(paper.rgb,ink,mask*mix(0.16,0.065,highlight)),paper.a);
}`,Dv=Tv+Ev;function Ov(e){return e.replace(`layout(location = 1) in vec4 aPageRect;`,`layout(location = 1) in vec4 aPageRect;
layout(location = 4) in float aPageLoading;
flat out float vPageLoading;`).replace(`vec2 world = aPageRect.xy + aPageRect.zw * localTopDown;`,`vec2 world = aPageRect.xy + aPageRect.zw * localTopDown;
  vPageLoading = aPageLoading;`)}function kv(e){return e.replace(`void main() {`,`uniform float uPagePlaceholderTime;\nflat in float vPageLoading;\n${wv}\nvoid main() {`).replace(`if (color.a <= 0.001)`,`color = heprPagePlaceholder(color,vUv,vPageLoading,uPagePlaceholderTime);
  if (color.a <= 0.001)`)}var Av=String.raw`#version 300 es
// BC7 (BPTC) mode-6 / mode-4 fragment-shader encoder — WebGL2 port of
// bc7.wgsl.
//
// One fragment per 4×4 block → 16-byte block as 4 × u32 in outColor. Per
// block the covariance picks mode 6 (one RGBA line, 16 levels) or mode 4
// (one channel split off into its own scalar plane, the other three on a
// line; 2-bit + 3-bit index sets), both then encoded by the same extents +
// stored-projection index passes. Gray + opaque blocks take an integer 1-D
// tail: lossless for spans ≤ 15 with odd endpoints (alpha exactly 255),
// alpha-aware scalar LSQ refit above. See bc7_fast_f16.wgsl for the design,
// the mode-decision model, the bit layouts and the measurements.
//
// Same arithmetic, in the same order, as bc7.wgsl — the two produce the
// same blocks.

precision highp float;
precision highp int;

uniform sampler2D uSrc;
uniform ivec2 uSrcSize;
uniform int uFlipY;

layout(location = 0) out uvec4 outColor;

// Mode-4 endpoint-precision charge (8-bit² covariance units).
const float N4 = 38.1;

// Per-invocation scratch (mirrors the WGSL function-scope arrays).
vec4 gPixels[16];
float gT[16];

// Nibble-slot compaction for the mode-4 index fields.
uint compact2(uint x) {
  uint y = (x | (x >> 2u)) & 0x0F0F0F0Fu;
  y = (y | (y >> 4u)) & 0x00FF00FFu;
  return (y | (y >> 8u)) & 0x0000FFFFu;
}
uint compact3(uint x) {
  uint y = (x & 0x07070707u) | ((x >> 1u) & 0x38383838u);
  y = (y & 0x003F003Fu) | ((y >> 2u) & 0x0FC00FC0u);
  return (y & 0x00000FFFu) | ((y >> 4u) & 0x00FFF000u);
}

// Gray + opaque block (every texel R == G == B, A == 255) from gPixels[].x,
// packed straight into the 4 block words. 8-bit endpoints E = 2q + p; RGB
// share q, alpha is 254 + p.
uvec4 encodeGray(float vmin, float vmax) {
  float e0 = vmin;
  float e1 = vmax;
  if (vmax - vmin <= 15.0) {
    // LOSSLESS: integer endpoints ≤ 15 apart cover every integer between
    // them and round(15·(v − e0)/d) selects it; even endpoints step outward
    // while the span stays ≤ 15 so both p-bits are 1 (alpha 255).
    if (fract(e0 * 0.5) == 0.0 && e0 > 0.0 && e1 - e0 < 15.0) { e0 -= 1.0; }
    if (fract(e1 * 0.5) == 0.0 && e1 < 255.0 && e1 - e0 < 15.0) { e1 += 1.0; }
  } else {
    // Moment-form scalar LSQ refit on the seed levels, all four p-bit
    // combinations priced including the alpha term, accept-if-better.
    float k1 = 15.0 / (vmax - vmin);
    float k0 = 0.5 - vmin * k1;
    float sL = 0.0;
    float sLL = 0.0;
    float sv = 0.0;
    float sLv = 0.0;
    for (int k = 0; k < 16; k++) {
      float v = gPixels[k].x;
      float L = floor(v * k1 + k0);
      sL += L;
      sLL += L * L;
      sv += v;
      sLv += L * v;
    }
    float C = sLL * (1.0 / 225.0);
    float B = sL * (1.0 / 15.0) - C;
    float A = 16.0 - sL * (2.0 / 15.0) + C;
    float Y = sLv * (1.0 / 15.0);
    float X = sv - Y;
    float det = A * C - B * B;
    if (det > 1e-3) {
      float s0 = clamp((C * X - B * Y) / det, 0.0, 255.0);
      float s1 = clamp((A * Y - B * X) / det, 0.0, 255.0);
      // price(e0, e1, p0, p1) up to the block constant: RGB ×3 + alpha.
      float ps0 = vmin - 2.0 * floor(vmin * 0.5);
      float ps1 = vmax - 2.0 * floor(vmax * 0.5);
      float best = 3.0 * (A * vmin * vmin + 2.0 * B * vmin * vmax + C * vmax * vmax - 2.0 * (X * vmin + Y * vmax))
        + A * (1.0 - ps0) + 2.0 * B * (1.0 - ps0) * (1.0 - ps1) + C * (1.0 - ps1);
      for (int pc = 0; pc < 4; pc++) {
        float p0 = float(pc & 1);
        float p1 = float(pc >> 1);
        float c0 = 2.0 * clamp(floor((s0 - p0) * 0.5 + 0.5), 0.0, 127.0) + p0;
        float c1 = 2.0 * clamp(floor((s1 - p1) * 0.5 + 0.5), 0.0, 127.0) + p1;
        float pr = 3.0 * (A * c0 * c0 + 2.0 * B * c0 * c1 + C * c1 * c1 - 2.0 * (X * c0 + Y * c1))
          + A * (1.0 - p0) + 2.0 * B * (1.0 - p0) * (1.0 - p1) + C * (1.0 - p1);
        if (pr < best) {
          best = pr;
          e0 = c0;
          e1 = c1;
        }
      }
    }
  }
  uint glo = 0u;
  uint ghi = 0u;
  if (e1 != e0) {
    float k1 = 15.0 / (e1 - e0);
    float k0 = 0.5 - e0 * k1;
    for (int k = 0; k < 8; k++) {
      float sg = clamp(floor(gPixels[k].x * k1 + k0), 0.0, 15.0);
      glo |= uint(sg) << uint(k * 4);
    }
    for (int k = 8; k < 16; k++) {
      float sg = clamp(floor(gPixels[k].x * k1 + k0), 0.0, 15.0);
      ghi |= uint(sg) << uint((k - 8) * 4);
    }
  }
  uint u0 = uint(e0);
  uint u1 = uint(e1);
  // Anchor rule: pixel 0's index MSB must be 0 — swap + reflect (bitwise NOT).
  if ((glo & 0x8u) != 0u) {
    uint t = u0; u0 = u1; u1 = t;
    glo = ~glo; ghi = ~ghi;
  }
  uint q0 = u0 >> 1u;
  uint q1 = u1 >> 1u;
  return uvec4(
    0x40u | (q0 << 7u) | (q1 << 14u) | (q0 << 21u) | (q1 << 28u),
    (q1 >> 4u) | (q0 << 3u) | (q1 << 10u) | (127u << 17u) | (127u << 24u) | ((u0 & 1u) << 31u),
    (u1 & 1u) | ((glo & 0x7u) << 1u) | (glo & 0xFFFFFFF0u),
    ghi
  );
}

void main() {
  ivec2 base = ivec2(gl_FragCoord.xy) * 4;
  ivec2 mx = uSrcSize - ivec2(1);

  // Load pass: texels (8-bit integer domain), bbox and the gray test.
  vec4 lo = vec4(255.0);
  vec4 hi = vec4(0.0);
  float gd = 0.0;
  ivec4 xs = min(ivec4(base.x) + ivec4(0, 1, 2, 3), ivec4(mx.x));
  ivec4 ys = min(ivec4(base.y) + ivec4(0, 1, 2, 3), ivec4(mx.y));
  for (int i = 0; i < 16; i++) {
    int py = ys[i >> 2];
    int sy = (uFlipY != 0) ? (uSrcSize.y - 1 - py) : py;
    vec4 px = clamp(floor(texelFetch(uSrc, ivec2(xs[i & 3], sy), 0) * 255.0 + 0.5), vec4(0.0), vec4(255.0));
    gPixels[i] = px;
    lo = min(lo, px);
    hi = max(hi, px);
    gd = max(gd, max(abs(px.x - px.y), abs(px.x - px.z)));
  }

  if (lo.w == 255.0 && gd == 0.0) {
    outColor = encodeGray(lo.x, hi.x);
    return;
  }

  // Covariance (10 symmetric products) over d = px − p0, stored back into
  // gPixels: every later pass works block-relative.
  vec4 p0v = gPixels[0];
  gPixels[0] = vec4(0.0);
  vec4 sd = vec4(0.0);
  vec4 cx = vec4(0.0);
  vec3 cy = vec3(0.0);
  vec2 cz = vec2(0.0);
  float cw = 0.0;
  for (int i = 1; i < 16; i++) {
    vec4 d = gPixels[i] - p0v;
    gPixels[i] = d;
    sd = sd + d;
    cx = cx + d.x * d;
    cy = cy + d.y * d.yzw;
    cz = cz + d.z * d.zw;
    cw = cw + d.w * d.w;
  }
  vec4 md = sd * (1.0 / 16.0);
  vec4 sd4 = sd * 0.25;
  cx = cx - sd4.x * sd4;
  cy = cy - sd4.y * sd4.yzw;
  cz = cz - sd4.z * sd4.zw;
  cw = cw - sd4.w * sd4.w;
  vec4 diag = vec4(cx.x, cy.x, cz.x, cw);
  float trace = diag.x + diag.y + diag.z + diag.w;

  // Mode decision + fit axis. Flat blocks keep axis 0.
  bool use4 = false;
  bool idx1 = false;
  uint ch = 0u;
  vec4 cmask = vec4(1.0);
  vec4 axisF = vec4(0.0);
  if (trace > 0.254) {
    float s = 1.0 / trace;
    vec4 m0 = cx * s;
    vec4 m1 = vec4(cx.y, cy) * s;
    vec4 m2 = vec4(cx.z, cy.y, cz) * s;
    vec4 m3 = vec4(cx.w, cy.z, cz.y, cw) * s;
    vec4 axis = m0;
    float dm = diag.x;
    if (diag.y > dm) { axis = m1; dm = diag.y; }
    if (diag.z > dm) { axis = m2; dm = diag.z; }
    if (diag.w > dm) { axis = m3; }
    axis = axis * inversesqrt(dot(axis, axis));
    axis = vec4(dot(m0, axis), dot(m1, axis), dot(m2, axis), dot(m3, axis));
    axis = vec4(dot(m0, axis), dot(m1, axis), dot(m2, axis), dot(m3, axis));
    float a4 = max(dot(axis, axis), 1e-12);
    axis = axis * inversesqrt(a4);
    float lamn = sqrt(sqrt(a4));
    float lam = lamn * trace;

    // λ3 for all four scalar-channel candidates at once (lane c).
    vec4 a2 = axis * axis;
    vec4 nn = vec4(0.0);
    { vec4 wr = lamn * axis.x - axis * m0; nn = nn + wr * wr * vec4(0.0, 1.0, 1.0, 1.0); }
    { vec4 wr = lamn * axis.y - axis * m1; nn = nn + wr * wr * vec4(1.0, 0.0, 1.0, 1.0); }
    { vec4 wr = lamn * axis.z - axis * m2; nn = nn + wr * wr * vec4(1.0, 1.0, 0.0, 1.0); }
    { vec4 wr = lamn * axis.w - axis * m3; nn = nn + wr * wr * vec4(1.0, 1.0, 1.0, 0.0); }
    vec4 l3v = sqrt(nn / max(vec4(1.0) - a2, vec4(1e-3))) * trace;
    float d1 = max(max(diag.x, diag.y), max(diag.z, diag.w));
    bvec4 oh1 = equal(diag, vec4(d1));
    vec4 dr = mix(diag, vec4(-1.0), oh1);
    float d2 = max(max(dr.x, dr.y), max(dr.z, dr.w));
    l3v = clamp(l3v, mix(vec4(d1), vec4(d2), oh1), vec4(trace) - diag);

    vec4 sb = max(l3v, diag) * (48.0 / 49.0) + min(l3v, diag) * (8.0 / 9.0);
    float smax = max(max(sb.x, sb.y), max(sb.z, sb.w));
    use4 = smax - N4 > lam * (224.0 / 225.0);
    if (sb.y == smax) { ch = 1u; }
    if (sb.z == smax) { ch = 2u; }
    if (sb.w == smax) { ch = 3u; }
    vec4 ohc = mix(vec4(0.0), vec4(1.0), equal(uvec4(ch), uvec4(0u, 1u, 2u, 3u)));
    idx1 = dot(l3v - diag, ohc) > 0.0;

    vec4 col = ch == 3u ? m3 : (ch == 2u ? m2 : (ch == 1u ? m1 : m0));
    cmask = use4 ? vec4(1.0) - ohc : vec4(1.0);
    vec4 v = use4 ? (lamn * axis - dot(axis, ohc) * col) * cmask + (hi - lo) * cmask * (1e-3 / 255.0) : axis;
    v = v * inversesqrt(max(dot(v, v), 1e-12));
    v = vec4(dot(m0, v), dot(m1, v), dot(m2, v), dot(m3, v)) * cmask;
    float vv = dot(v, v);
    axisF = vv > 1e-6 ? v * inversesqrt(max(vv, 1e-12)) : vec4(0.0);
  }

  // Mode-4 scalar plane: 6-bit codes at the channel's exact extremes, index
  // map v = ⌊d·ks + os⌋. chs = 0 leaves ks = 0 for mode 6.
  vec4 chs = vec4(1.0) - cmask;
  float Ls = idx1 ? 3.0 : 7.0;
  uint A0 = uint(floor(dot(lo, chs) * (63.0 / 255.0) + 0.5));
  uint A1 = uint(floor(dot(hi, chs) * (63.0 / 255.0) + 0.5));
  vec4 ks = vec4(0.0);
  float os = 0.0;
  {
    float d0a = float((A0 << 2u) | (A0 >> 4u));
    float d1a = float((A1 << 2u) | (A1 >> 4u));
    float aspan = d1a - d0a;
    if (aspan > 0.0) {
      float sca = Ls / aspan;
      ks = chs * sca;
      os = (dot(p0v, chs) - d0a) * sca + 0.5;
    }
    // Anchor rule up front: pixel 0 (the d-space origin) indexes at ⌊os⌋.
    if (floor(os) >= (Ls + 1.0) * 0.5) {
      uint t = A0; A0 = A1; A1 = t;
      ks = -ks;
      os = Ls + 1.0 - os;
    }
  }

  // ONE extents pass along the fit axis: projections kept for the colour
  // indices, scalar-plane indices ride along as float nibble fields.
  float tMin = 1e30;
  float tMax = -1e30;
  float ga = 0.0;
  float gb = 0.0;
  float gc = 0.0;
  float w3 = 1.0;
  for (int k = 0; k < 16; k++) {
    float t = dot(gPixels[k], axisF);
    gT[k] = t;
    tMin = min(tMin, t);
    tMax = max(tMax, t);
    float v = clamp(floor(dot(gPixels[k], ks) + os), 0.0, Ls);
    if (k == 0) { v = min(v, floor(Ls * 0.5)); }
    if (k < 6) { ga = ga + v * w3; } else if (k < 12) { gb = gb + v * w3; } else { gc = gc + v * w3; }
    w3 = (k == 5 || k == 11) ? 1.0 : w3 * 16.0;
  }
  float tm = dot(md, axisF);
  vec4 mean = p0v + md;
  vec4 seedLo = clamp(mean + (tMin - tm) * axisF, vec4(0.0), vec4(255.0));
  vec4 seedHi = clamp(mean + (tMax - tm) * axisF, vec4(0.0), vec4(255.0));

  // Endpoint codes, one quantiser for both modes: mode 6 = 7-bit + p-bit,
  // mode 4 colour = 5-bit.
  float sc = use4 ? 31.0 / 255.0 : 0.5;
  float cmax = use4 ? 31.0 : 127.0;
  vec4 y0 = seedLo * sc;
  vec4 y1 = seedHi * sc;
  vec4 r0 = min(floor(y0 + 0.5), vec4(cmax));
  vec4 r1 = min(floor(y1 + 0.5), vec4(cmax));
  vec4 f0 = min(floor(y0), vec4(cmax));
  vec4 f1 = min(floor(y1), vec4(cmax));
  vec4 e0r = r0 - y0;
  vec4 e0f = f0 + 0.5 - y0;
  vec4 e1r = r1 - y1;
  vec4 e1f = f1 + 0.5 - y1;
  bool pp0 = !use4 && dot(e0f, e0f) < dot(e0r, e0r);
  bool pp1 = !use4 && dot(e1f, e1f) < dot(e1r, e1r);
  vec4 g0 = pp0 ? f0 : r0;
  vec4 g1 = pp1 ? f1 : r1;
  uvec4 q0c = uvec4(g0);
  uvec4 q1c = uvec4(g1);
  uint P0 = uint(pp0);
  uint P1 = uint(pp1);
  // Decoded 8-bit endpoints: mode 6 2q + p, mode 4 q << 3 | q >> 2.
  vec4 d0 = use4 ? g0 * 8.0 + floor(g0 * 0.25) : g0 * 2.0 + float(P0);
  vec4 d1 = use4 ? g1 * 8.0 + floor(g1 * 0.25) : g1 * 2.0 + float(P1);
  float Lc = use4 ? (idx1 ? 7.0 : 3.0) : 15.0;

  float tau0 = dot(d0 - p0v, axisF);
  float tau1 = dot(d1 - p0v, axisF);
  float span = tau1 - tau0;
  float kc = 0.0;
  float oc = 0.0;
  if (abs(span) > 0.25) {
    kc = Lc / span;
    oc = 0.5 - tau0 * kc;
  }
  // Anchor rule up front (pixel 0 projects to t = 0, index ⌊oc⌋).
  if (min(floor(oc), Lc) >= (Lc + 1.0) * 0.5) {
    uvec4 tq = q0c; q0c = q1c; q1c = tq;
    uint tp = P0; P0 = P1; P1 = tp;
    oc = 0.5 + tau1 * kc;
    kc = -kc;
  }
  float fa = 0.0;
  float fb = 0.0;
  float fc = 0.0;
  float w = 1.0;
  for (int k = 0; k < 16; k++) {
    float sg = clamp(floor(gT[k] * kc + oc), 0.0, Lc);
    if (k == 0) { sg = min(sg, floor(Lc * 0.5)); }
    if (k < 6) { fa = fa + sg * w; } else if (k < 12) { fb = fb + sg * w; } else { fc = fc + sg * w; }
    w = (k == 5 || k == 11) ? 1.0 : w * 16.0;
  }
  uint ub = uint(fb);
  uint ilo = uint(fa) | (ub << 24u);
  uint ihi = (ub >> 8u) | (uint(fc) << 16u);

  if (!use4) {
    outColor = uvec4(
      0x40u | (q0c.x << 7u) | (q1c.x << 14u) | (q0c.y << 21u) | (q1c.y << 28u),
      (q1c.y >> 4u) | (q0c.z << 3u) | (q1c.z << 10u) | (q0c.w << 17u) | (q1c.w << 24u) | (P0 << 31u),
      P1 | ((ilo & 0x7u) << 1u) | (ilo & 0xFFFFFFF0u),
      ihi
    );
  } else {
    uint vb = uint(gb);
    uint slo = uint(ga) | (vb << 24u);
    uint shi = (vb >> 8u) | (uint(gc) << 16u);
    uint c2 = compact2(idx1 ? slo : ilo) | (compact2(idx1 ? shi : ihi) << 16u);
    uint iA = compact3(idx1 ? ilo : slo);
    uint iB = compact3(idx1 ? ihi : shi);
    uint R0 = ch == 0u ? q0c.w : q0c.x;
    uint G0 = ch == 1u ? q0c.w : q0c.y;
    uint B0 = ch == 2u ? q0c.w : q0c.z;
    uint R1 = ch == 0u ? q1c.w : q1c.x;
    uint G1 = ch == 1u ? q1c.w : q1c.y;
    uint B1 = ch == 2u ? q1c.w : q1c.z;
    uint rot = (ch + 1u) & 3u;
    uint field2 = (c2 & 1u) | ((c2 >> 2u) << 1u);
    uint fLo = (iA & 3u) | ((iA >> 3u) << 2u) | (iB << 23u);
    uint fHi = iB >> 9u;
    outColor = uvec4(
      0x10u | (rot << 5u) | (uint(idx1) << 7u) | (R0 << 8u) | (R1 << 13u) | (G0 << 18u) | (G1 << 23u) | (B0 << 28u),
      (B0 >> 4u) | (B1 << 1u) | (A0 << 6u) | (A1 << 12u) | ((field2 & 0x3FFFu) << 18u),
      (field2 >> 14u) | (fLo << 17u),
      (fLo >> 15u) | (fHi << 17u)
    );
  }
}
`,jv=String.raw`#version 300 es
// ASTC 4×4 LDR fragment-shader encoder — WebGL2 port of astc4x4.wgsl.
//
// One fragment per 4×4 block → 16-byte block as 4 × u32 in outColor.
// Restricted subset: single partition, no dual-plane, with the block class
// picked per block from the content (see astc4x4_ref.ts for layouts, block
// modes, the QUANT_192 trit ISE and the weight-stream bit order):
//   gray + opaque → CEM 0  (luminance), 5-bit weights, mode 0x253
//   opaque        → CEM 8  (RGB), 3-channel PCA extents, two bit budgets:
//                   span > 12 → QUANT_192 endpoints (trit ISE) + 4-bit
//                   weights, mode 0x242; span ≤ 12 → 8-bit endpoints +
//                   3-bit weights, mode 0x053
//   translucent   → CEM 12 (RGBA), 2-bit weights, mode 0x042 — PCA seed →
//                   fused projection + least-squares refit, the fit pass's
//                   weights shipped
// Same algorithm and arithmetic as astc4x4.wgsl (roundEven == WGSL round());
// see astc4x4_fast_f16.wgsl for the design measurements.

precision highp float;
precision highp int;

uniform sampler2D uSrc;
uniform ivec2 uSrcSize;
uniform int uFlipY;

layout(location = 0) out uvec4 outColor;

ivec4 gPixels[16];

ivec4 to8(vec4 v) {
  return ivec4(clamp(floor(v * 255.0 + 0.5), vec4(0.0), vec4(255.0)));
}

// GLSL ES 3.00 has no bitfieldReverse; classic 5-step swap. Weight-stream
// bit q lives at block bit 127 − q, so a stream word assembled LSB-first
// maps onto a block word with one reversal (see astc4x4.wgsl).
uint rev32(uint x) {
  uint v = x;
  v = ((v & 0x55555555u) << 1) | ((v >> 1) & 0x55555555u);
  v = ((v & 0x33333333u) << 2) | ((v >> 2) & 0x33333333u);
  v = ((v & 0x0F0F0F0Fu) << 4) | ((v >> 4) & 0x0F0F0F0Fu);
  v = ((v & 0x00FF00FFu) << 8) | ((v >> 8) & 0x00FF00FFu);
  return (v << 16) | (v >> 16);
}

// Principal colour axis via covariance power-iteration (RGBA, 8-bit integer
// pixel domain), seeded with the bbox diagonal. Returns a unit axis, or
// vec4(0.0) for a degenerate (constant) block. The bbox diagonal alone is
// sign-blind and points across anti-correlated data (normal maps, hue
// edges) instead of along it.
vec4 principalAxis4(vec4 mean, vec4 seed, int iters) {
  vec4 c0v = vec4(0.0);
  vec4 c1v = vec4(0.0);
  vec4 c2v = vec4(0.0);
  vec4 c3v = vec4(0.0);
  for (int k = 0; k < 16; k++) {
    vec4 d = vec4(gPixels[k]) - mean;
    c0v += d.x * d;
    c1v += d.y * d;
    c2v += d.z * d;
    c3v += d.w * d;
  }
  vec4 v = seed;
  float len = length(v);
  if (len < 1e-9) { return vec4(0.0); }
  v = v / len;
  for (int it = 0; it < iters; it++) {
    vec4 nv = vec4(dot(c0v, v), dot(c1v, v), dot(c2v, v), dot(c3v, v));
    len = length(nv);
    if (len < 1e-12) { return vec4(0.0); }
    v = nv / len;
  }
  return v;
}

// Principal RGB axis for opaque blocks (alpha is constant there, so the
// 4th covariance lane is dead weight). Same iteration as principalAxis4.
vec3 principalAxis3(vec3 mean, vec3 seed) {
  vec3 c0v = vec3(0.0);
  vec3 c1v = vec3(0.0);
  vec3 c2v = vec3(0.0);
  for (int k = 0; k < 16; k++) {
    vec3 d = vec3(gPixels[k].xyz) - mean;
    c0v += d.x * d;
    c1v += d.y * d;
    c2v += d.z * d;
  }
  vec3 v = seed;
  float len = length(v);
  if (len < 1e-9) { return vec3(0.0); }
  v = v / len;
  for (int it = 0; it < 8; it++) {
    vec3 nv = vec3(dot(c0v, v), dot(c1v, v), dot(c2v, v));
    len = length(nv);
    if (len < 1e-12) { return vec3(0.0); }
    v = nv / len;
  }
  return v;
}

// One pass over the block: project every pixel onto the e0→e1 line (4
// colinear levels, so the nearest entry is the rounded projection), pack
// the 2-bit weights, and solve the least-squares refit from the
// normal-equation sums accumulated in the same pass.
struct Fit { ivec4 e0; ivec4 e1; bool valid; uint wstream; };
Fit projFit(ivec4 e0, ivec4 e1) {
  Fit r;
  r.e0 = ivec4(0);
  r.e1 = ivec4(0);
  r.valid = false;
  r.wstream = 0u;
  vec4 dir = vec4(e1 - e0);
  float dd = dot(dir, dir);
  if (dd == 0.0) { return r; }
  vec4 e0f = vec4(e0);
  float inv = 3.0 / dd;
  float sAA = 0.0;
  float sBB = 0.0;
  float sAB = 0.0;
  vec4 sAV = vec4(0.0);
  vec4 sBV = vec4(0.0);
  float sMin = 3.0;
  float sMax = 0.0;
  for (int k = 0; k < 16; k++) {
    vec4 v = vec4(gPixels[k]);
    float s = clamp(floor(dot(v - e0f, dir) * inv + 0.5), 0.0, 3.0);
    r.wstream |= uint(s) << (2u * uint(k));
    sMin = min(sMin, s);
    sMax = max(sMax, s);
    float b = s * (1.0 / 3.0);
    float a = 1.0 - b;
    sAA += a * a; sBB += b * b; sAB += a * b;
    sAV += a * v; sBV += b * v;
  }
  // Rank-1 guard: one level ⇒ singular system (the solve would be noise).
  if (sMin == sMax) { return r; }
  float det = sAA * sBB - sAB * sAB;
  if (abs(det) < 1e-3) { return r; }
  r.e0 = ivec4(clamp(roundEven((sBB * sAV - sAB * sBV) / det), vec4(0.0), vec4(255.0)));
  r.e1 = ivec4(clamp(roundEven((sAA * sBV - sAB * sAV) / det), vec4(0.0), vec4(255.0)));
  r.valid = true;
  return r;
}

// ISE trit-block encoder: 5 trits → the 8-bit T field (the inverse of the
// spec's trit-block decode; see astc4x4_ref.ts).
uint tritEnc(uint t0, uint t1, uint t2, uint t3, uint t4) {
  uint c = (t2 == 2u && t1 == 2u) ? (12u | t0)
    : (t2 == 2u ? ((t1 << 4u) | (t0 << 2u) | 3u) : ((t2 << 4u) | (t1 << 2u) | t0));
  return (t3 == 2u && t4 == 2u) ? (((c >> 2u) << 5u) | 28u | (c & 3u))
    : (t4 == 2u ? ((t3 << 7u) | 96u | c) : ((t4 << 7u) | (t3 << 5u) | c));
}

// Nearest QUANT_192 endpoint to x ∈ [0,255]; returns (ISE value =
// trit·64 + bits, unquantised level). See astc4x4_fast_f16.wgsl.
uvec2 q192(float x) {
  uint v = uint(clamp(floor(x + 0.5), 0.0, 255.0));
  bool up = v > 127u;
  uint u = up ? 255u - v : v;
  if ((u & 3u) == 3u) {
    float xu = up ? 255.0 - x : x;
    u = (xu > float(u) && u < 127u) ? u + 1u : u - 1u;
  }
  return uvec2(((u & 3u) << 6u) | ((u >> 2u) << 1u) | (up ? 1u : 0u), up ? 255u - u : u);
}

void main() {
  ivec2 base = ivec2(gl_FragCoord.xy) * 4;
  ivec2 maxXY = uSrcSize - ivec2(1);

  ivec4 lo = ivec4(255);
  ivec4 hi = ivec4(0);
  ivec4 isum = ivec4(0);
  int gd = 0; // max |R−G|, |R−B| over the block; 0 ⇔ exactly grayscale
  for (int i = 0; i < 16; i++) {
    ivec2 p = clamp(base + ivec2(i & 3, i >> 2), ivec2(0), maxXY);
    int sy = (uFlipY != 0) ? (uSrcSize.y - 1 - p.y) : p.y;
    ivec4 px = to8(texelFetch(uSrc, ivec2(p.x, sy), 0));
    gPixels[i] = px;
    lo = min(lo, px);
    hi = max(hi, px);
    isum += px;
    gd = max(gd, max(abs(px.x - px.y), abs(px.x - px.z)));
  }
  bool opaque = lo.w == 255;

  uint w0 = 0u; uint w1 = 0u; uint w2 = 0u; uint w3 = 0u;

  if (opaque && gd == 0) {
    // ---------------- Luminance path: CEM 0, 5-bit weights ----------------
    // Endpoints at the exact extremes; 32 palette levels make an LSQ refit
    // unnecessary.
    uint L0 = uint(lo.x);
    uint L1 = uint(hi.x);
    uint s0 = 0u; uint s1 = 0u; uint s2 = 0u;
    if (L1 > L0) {
      float sc = 64.0 / float(hi.x - lo.x);
      // Exact nearest entry of the QUANT_32 grid: unq = 2w for w ≤ 15,
      // 2w + 2 for w ≥ 16 (4-wide gap at the middle, so uniform rounding
      // is wrong there). Best candidate of each half, keep the closer.
      for (int k = 0; k < 16; k++) {
        float u = clamp(float(gPixels[k].x - lo.x) * sc, 0.0, 64.0);
        float wlo = clamp(floor(u * 0.5 + 0.5), 0.0, 15.0);
        float whi = clamp(floor((u - 2.0) * 0.5 + 0.5), 16.0, 31.0);
        bool pick = abs(u - wlo * 2.0) <= abs(u - (whi * 2.0 + 2.0));
        uint w = uint(pick ? wlo : whi);
        // Stream bit q = 5k + j; straddles handled with constant shifts.
        uint off = 5u * uint(k);
        if (off < 28u) { s0 |= (w << off); }
        else if (off == 30u) { s0 |= (w << 30u); s1 |= (w >> 2u); }
        else if (off < 60u) { s1 |= (w << (off - 32u)); }
        else if (off == 60u) { s1 |= (w << 28u); s2 |= (w >> 4u); }
        else { s2 |= (w << (off - 64u)); }
      }
    }
    // Mode 0x253, partitions−1 = 0, CEM 0, L0 @17, L1 @25 (top bit spills
    // into word 1 bit 0); stream words map onto block words via rev32.
    w0 = 0x253u | (L0 << 17u) | (L1 << 25u);
    w1 = (L1 >> 7u) | rev32(s2);
    w2 = rev32(s1);
    w3 = rev32(s0);
  } else if (opaque) {
    // ------------- Opaque colour: CEM 8, two bit budgets -------------------
    // span > 12 → QUANT_192 endpoints + 4-bit weights (mode 0x242), else
    // exact 8-bit endpoints + 3-bit weights (mode 0x053); endpoints are the
    // bbox-clamped PCA extents.
    vec3 mean3 = vec3(isum.xyz) * (1.0 / 16.0);
    vec3 lo3 = vec3(lo.xyz);
    vec3 hi3 = vec3(hi.xyz);
    vec3 x0 = lo3;
    vec3 x1 = hi3;
    vec3 axis = principalAxis3(mean3, hi3 - lo3);
    if (dot(axis, axis) > 0.0) {
      float tMin = 1e30;
      float tMax = -1e30;
      for (int k = 0; k < 16; k++) {
        float t = dot(vec3(gPixels[k].xyz) - mean3, axis);
        tMin = min(tMin, t);
        tMax = max(tMax, t);
      }
      x0 = clamp(mean3 + tMin * axis, lo3, hi3);
      x1 = clamp(mean3 + tMax * axis, lo3, hi3);
    }
    ivec3 span3 = hi.xyz - lo.xyz;
    bool small = max(max(span3.x, span3.y), span3.z) <= 12;
    uvec2 r0; uvec2 g0; uvec2 b0;
    uvec2 r1; uvec2 g1; uvec2 b1;
    if (small) {
      uvec3 q0 = uvec3(clamp(floor(x0 + 0.5), vec3(0.0), vec3(255.0)));
      uvec3 q1 = uvec3(clamp(floor(x1 + 0.5), vec3(0.0), vec3(255.0)));
      r0 = uvec2(q0.x); g0 = uvec2(q0.y); b0 = uvec2(q0.z);
      r1 = uvec2(q1.x); g1 = uvec2(q1.y); b1 = uvec2(q1.z);
    } else {
      r0 = q192(x0.x); g0 = q192(x0.y); b0 = q192(x0.z);
      r1 = q192(x1.x); g1 = q192(x1.y); b1 = q192(x1.z);
    }
    // Blue-contraction ordering on the unquantised levels.
    if (r0.y + g0.y + b0.y > r1.y + g1.y + b1.y) {
      uvec2 tr = r0; r0 = r1; r1 = tr;
      uvec2 tg = g0; g0 = g1; g1 = tg;
      uvec2 tb = b0; b0 = b1; b1 = tb;
    }
    vec3 d0 = vec3(uvec3(r0.y, g0.y, b0.y));
    vec3 d1 = vec3(uvec3(r1.y, g1.y, b1.y));
    // One weight loop for both budgets; weights as 4-bit nibbles.
    float lmax = small ? 7.0 : 15.0;
    vec3 dir = d1 - d0;
    float dd = dot(dir, dir);
    uint s0 = 0u;
    uint s1 = 0u;
    if (dd > 0.0) {
      float inv = lmax / dd;
      for (int k = 0; k < 8; k++) {
        uint w = uint(clamp(floor(dot(vec3(gPixels[k].xyz) - d0, dir) * inv + 0.5), 0.0, lmax));
        s0 |= w << (4u * uint(k));
      }
      for (int k = 8; k < 16; k++) {
        uint w = uint(clamp(floor(dot(vec3(gPixels[k].xyz) - d0, dir) * inv + 0.5), 0.0, lmax));
        s1 |= w << (4u * uint(k - 8));
      }
    }
    if (small) {
      // Mode 0x053: plain 8-bit endpoints; the 3-bit weight stream is the
      // nibbles compacted (8 nibbles → 24 bits).
      uint c0 = (s0 & 0x07070707u) | ((s0 & 0x70707070u) >> 1u);
      c0 = (c0 & 0x003F003Fu) | ((c0 & 0x3F003F00u) >> 2u);
      c0 = (c0 & 0x00000FFFu) | ((c0 & 0x0FFF0000u) >> 4u);
      uint c1 = (s1 & 0x07070707u) | ((s1 & 0x70707070u) >> 1u);
      c1 = (c1 & 0x003F003Fu) | ((c1 & 0x3F003F00u) >> 2u);
      c1 = (c1 & 0x00000FFFu) | ((c1 & 0x0FFF0000u) >> 4u);
      w0 = 0x053u | (8u << 13u) | (r0.x << 17u) | (r1.x << 25u);
      w1 = (r1.x >> 7u) | (g0.x << 1u) | (g1.x << 9u) | (b0.x << 17u) | (b1.x << 25u);
      w2 = (b1.x >> 7u) | rev32(c1 >> 8u);
      w3 = rev32(c0 | (c1 << 24u));
    } else {
      // Mode 0x242: trit-ISE QUANT_192 endpoints (v0..v5 = R0 R1 G0 G1 B0
      // B1, 46 bits from bit 17: group 1 = v0..v4 with trit field T, group
      // 2 = v5 with its lone trit as 2 bits), 4-bit weights.
      uint tg = tritEnc(r0.x >> 6u, r1.x >> 6u, g0.x >> 6u, g1.x >> 6u, b0.x >> 6u);
      w0 = 0x242u | (8u << 13u) | ((r0.x & 63u) << 17u) | ((tg & 3u) << 23u) | ((r1.x & 63u) << 25u) | (((tg >> 2u) & 1u) << 31u);
      w1 = ((tg >> 3u) & 1u) | ((g0.x & 63u) << 1u) | (((tg >> 4u) & 1u) << 7u) | ((g1.x & 63u) << 8u)
        | (((tg >> 5u) & 3u) << 14u) | ((b0.x & 63u) << 16u) | ((tg >> 7u) << 22u) | ((b1.x & 63u) << 23u)
        | ((b1.x >> 6u) << 29u);
      w2 = rev32(s1);
      w3 = rev32(s0);
    }
  } else {
    // ------------- Translucent: CEM 12, 2-bit weights, PCA seed + refit ----
    vec4 mean = vec4(isum) * (1.0 / 16.0);
    // Fused LSQ fit seeded from the block's principal RGBA axis (4 power
    // iterations — the refit absorbs residual axis error) at the exact
    // projection extents, clamped to the block bbox (the unconstrained solve
    // extrapolates outside multi-cluster blocks and would bend the hue).
    ivec4 seed0 = lo;
    ivec4 seed1 = hi;
    vec4 axis = principalAxis4(mean, vec4(hi - lo), 4);
    if (dot(axis, axis) > 0.0) {
      float tMin = 1e30;
      float tMax = -1e30;
      for (int k = 0; k < 16; k++) {
        float t = dot(vec4(gPixels[k]) - mean, axis);
        tMin = min(tMin, t);
        tMax = max(tMax, t);
      }
      seed0 = ivec4(clamp(roundEven(mean + tMin * axis), vec4(0.0), vec4(255.0)));
      seed1 = ivec4(clamp(roundEven(mean + tMax * axis), vec4(0.0), vec4(255.0)));
    }
    ivec4 e0 = lo;
    ivec4 e1 = hi;
    uint fitStream = 0u;
    bool haveFitWeights = false;
    Fit r = projFit(seed0, seed1);
    if (r.valid) {
      e0 = clamp(r.e0, lo, hi);
      e1 = clamp(r.e1, lo, hi);
      fitStream = r.wstream;
      haveFitWeights = true;
    }
    bool swapped = false;
    if (e0.x + e0.y + e0.z > e1.x + e1.y + e1.z) {
      ivec4 t = e0; e0 = e1; e1 = t;
      swapped = true;
    }
    uvec4 E0 = uvec4(e0);
    uvec4 E1 = uvec4(e1);
    // Valid fits ship the fit-pass weights; the blue-contraction swap is a
    // full reflection w → 3−w = bitwise NOT of the packed stream.
    uint s0 = 0u;
    if (haveFitWeights) {
      s0 = swapped ? ~fitStream : fitStream;
    } else {
      vec4 dir = vec4(e1 - e0);
      float dd = dot(dir, dir);
      vec4 e0f = vec4(e0);
      if (dd > 0.0) {
        float inv = 3.0 / dd;
        for (int k = 0; k < 16; k++) {
          uint w = uint(clamp(floor(dot(vec4(gPixels[k]) - e0f, dir) * inv + 0.5), 0.0, 3.0));
          s0 |= w << (2u * uint(k));
        }
      }
    }
    // Mode 0x042, CEM 12 @13, endpoints R0 R1 G0 G1 B0 B1 A0 A1 from 17.
    w0 = 0x042u | (12u << 13u) | (E0.x << 17u) | (E1.x << 25u);
    w1 = (E1.x >> 7u) | (E0.y << 1u) | (E1.y << 9u) | (E0.z << 17u) | (E1.z << 25u);
    w2 = (E1.z >> 7u) | (E0.w << 1u) | (E1.w << 9u);
    w3 = rev32(s0);
  }

  outColor = uvec4(w0, w1, w2, w3);
}
`,Mv=String.raw`#version 300 es
// Fullscreen-triangle vertex shader for the WebGL block encoders.
//
// Draws a single oversized triangle covering the viewport from gl_VertexID
// alone — no vertex buffers / attributes needed (drawArrays(TRIANGLES, 0, 3)).
// The encoder sets the viewport to (blocks_x × blocks_y), so each rasterised
// fragment corresponds to exactly one 4×4 output block.
//
//   id 0 -> (-1,-1)   id 1 -> ( 3,-1)   id 2 -> (-1, 3)

void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`,Nv=4194304;function Pv(e){try{if(new Uint8Array(Uint32Array.of(16909060).buffer)[0]!==4||typeof e.getExtension!=`function`||typeof e.texStorage2D!=`function`||typeof e.readPixels!=`function`||typeof e.compressedTexSubImage2D!=`function`)return{bc7:!1,astc4x4:!1};let t=e.getExtension(`EXT_texture_compression_bptc`),n=e.getExtension(`WEBGL_compressed_texture_astc`);return{bc7:typeof t?.COMPRESSED_RGBA_BPTC_UNORM_EXT==`number`,astc4x4:typeof n?.COMPRESSED_RGBA_ASTC_4x4_KHR==`number`&&(!n.getSupportedProfiles||n.getSupportedProfiles().includes(`ldr`))}}catch{return{bc7:!1,astc4x4:!1}}}var Fv=class{gl;programs=new Map;failed=new Set;available;workspace=null;wasContextLost=!1;onContextLost=()=>{this.wasContextLost=!0,this.releaseWorkspace(),this.releasePrograms()};constructor(e){this.gl=e,this.available=Pv(e),e.canvas?.addEventListener?.(`webglcontextlost`,this.onContextLost)}get capabilities(){return this.refreshContext()?{bc7:this.available.bc7&&!this.failed.has(`bc7`),astc4x4:this.available.astc4x4&&!this.failed.has(`astc-4x4`)}:{bc7:!1,astc4x4:!1}}get workspaceBytes(){return this.workspace?.bytes??0}encode(e,t,n,r,i=Nv,a){I(a);let o=this.capabilities;if(!(r===`bc7`?o.bc7:o.astc4x4)||typeof this.gl.getBufferSubData!=`function`)throw Error(`WebGL ${r} block readback is unavailable.`);let s=this.gl,c=zv(s);try{let o=sg(t,n,r);if(o[0].width>Number(s.getParameter(s.MAX_TEXTURE_SIZE))||o[0].height>Number(s.getParameter(s.MAX_TEXTURE_SIZE)))throw Error(`Block-aligned raster exceeds this context's texture dimension limit.`);let c=new Uint8Array(o.reduce((e,t)=>e+t.byteLength,0)),l=this.getProgram(r);Bv(s);let u=this.getWorkspace(i);s.bindFramebuffer(s.FRAMEBUFFER,u.framebuffer),s.readBuffer(s.COLOR_ATTACHMENT0),s.useProgram(l.program),s.bindVertexArray(u.vao),s.uniform1i(l.source,0),s.uniform1i(l.flip,0);let d=0;for(let i of lg(e,t,n,a)){let e=Math.ceil(i.width/4);for(let t=0;t<i.height;t+=u.blockRows*4){I(a);let n=Math.min(u.blockRows*4,i.height-t),f=Math.ceil(n/4),p=e*f*16;s.bindTexture(s.TEXTURE_2D,u.source),s.texSubImage2D(s.TEXTURE_2D,0,0,0,i.width,n,s.RGBA,s.UNSIGNED_BYTE,i.data.subarray(t*i.width*4,(t+n)*i.width*4)),s.uniform2i(l.size,i.width,n),s.viewport(0,0,e,f),s.drawArrays(s.TRIANGLES,0,3),s.bindBuffer(s.PIXEL_PACK_BUFFER,u.buffer),s.readPixels(0,0,e,f,s.RGBA_INTEGER,s.UNSIGNED_INT,0);let m=o[d].byteOffset+t/4*e*16;s.getBufferSubData(s.PIXEL_PACK_BUFFER,0,c.subarray(m,m+p)),Lv(s,`${r} mip ${d} band readback`)}d++}return I(a),c}catch(e){throw a?.aborted||this.failed.add(r),this.releaseWorkspace(),e}finally{Vv(s,c)}}uploadEncoded(e,t,n,r){let i=sg(t,n,r),a=i.reduce((e,t)=>e+t.byteLength,0);if(!(e instanceof Uint8Array)||e.length!==a)throw RangeError(`Incorrect encoded raster mip byte length.`);let o=this.capabilities;if(!(r===`bc7`?o.bc7:o.astc4x4))throw Error(`WebGL ${r} compression is unavailable.`);let s=this.gl,c=zv(s),l=i[0],u=null;try{if(l.width>Number(s.getParameter(s.MAX_TEXTURE_SIZE))||l.height>Number(s.getParameter(s.MAX_TEXTURE_SIZE)))throw Error(`Block-aligned raster exceeds this context's texture dimension limit.`);Bv(s),u=Iv(s.createTexture(),`compressed texture`),s.bindTexture(s.TEXTURE_2D,u);let o=r===`bc7`?36492:37808;s.texStorage2D(s.TEXTURE_2D,i.length,o,l.width,l.height),s.texParameteri(s.TEXTURE_2D,s.TEXTURE_MIN_FILTER,s.LINEAR_MIPMAP_LINEAR),s.texParameteri(s.TEXTURE_2D,s.TEXTURE_MAG_FILTER,s.LINEAR),s.texParameteri(s.TEXTURE_2D,s.TEXTURE_WRAP_S,s.CLAMP_TO_EDGE),s.texParameteri(s.TEXTURE_2D,s.TEXTURE_WRAP_T,s.CLAMP_TO_EDGE),s.texParameteri(s.TEXTURE_2D,s.TEXTURE_MAX_LEVEL,i.length-1),Lv(s,`compressed texture allocation`);for(let[t,n]of i.entries())s.compressedTexSubImage2D(s.TEXTURE_2D,t,0,0,n.width,n.height,o,e.subarray(n.byteOffset,n.byteOffset+n.byteLength)),Lv(s,`${r} encoded mip ${t} upload`);return{texture:u,estimatedBytes:a,uvScale:[t/l.width,n/l.height]}}catch(e){throw u&&s.deleteTexture(u),this.failed.add(r),this.releaseWorkspace(),e}finally{Vv(s,c)}}upload(e,t,n,r,i=Nv){let a=this.capabilities;if(!(r===`bc7`?a.bc7:a.astc4x4))throw Error(`WebGL ${r} compression is unavailable.`);let o=this.gl,s=zv(o),c=null;try{let a=sg(t,n,r),s=a[0];if(s.width>Number(o.getParameter(o.MAX_TEXTURE_SIZE))||s.height>Number(o.getParameter(o.MAX_TEXTURE_SIZE)))throw Error(`Block-aligned raster exceeds this context's texture dimension limit.`);let l=this.getProgram(r);Bv(o);let u=this.getWorkspace(i);c=Iv(o.createTexture(),`compressed texture`),o.bindTexture(o.TEXTURE_2D,c);let d=r===`bc7`?36492:37808;o.texStorage2D(o.TEXTURE_2D,a.length,d,s.width,s.height),o.texParameteri(o.TEXTURE_2D,o.TEXTURE_MIN_FILTER,o.LINEAR_MIPMAP_LINEAR),o.texParameteri(o.TEXTURE_2D,o.TEXTURE_MAG_FILTER,o.LINEAR),o.texParameteri(o.TEXTURE_2D,o.TEXTURE_WRAP_S,o.CLAMP_TO_EDGE),o.texParameteri(o.TEXTURE_2D,o.TEXTURE_WRAP_T,o.CLAMP_TO_EDGE),o.texParameteri(o.TEXTURE_2D,o.TEXTURE_MAX_LEVEL,a.length-1),Lv(o,`compressed texture allocation`),o.bindFramebuffer(o.FRAMEBUFFER,u.framebuffer),o.readBuffer(o.COLOR_ATTACHMENT0),o.useProgram(l.program),o.bindVertexArray(u.vao),o.uniform1i(l.source,0),o.uniform1i(l.flip,0);let f=0;for(let i of lg(e,t,n)){let e=Math.ceil(i.width/4);for(let t=0;t<i.height;t+=u.blockRows*4){let n=Math.min(u.blockRows*4,i.height-t),a=Math.ceil(n/4),s=e*a*16;o.bindBuffer(o.PIXEL_UNPACK_BUFFER,null),o.bindTexture(o.TEXTURE_2D,u.source),o.texSubImage2D(o.TEXTURE_2D,0,0,0,i.width,n,o.RGBA,o.UNSIGNED_BYTE,i.data.subarray(t*i.width*4,(t+n)*i.width*4)),o.uniform2i(l.size,i.width,n),o.viewport(0,0,e,a),o.drawArrays(o.TRIANGLES,0,3),o.bindBuffer(o.PIXEL_PACK_BUFFER,u.buffer),o.readPixels(0,0,e,a,o.RGBA_INTEGER,o.UNSIGNED_INT,0),o.bindBuffer(o.PIXEL_UNPACK_BUFFER,u.buffer),o.bindTexture(o.TEXTURE_2D,c),o.compressedTexSubImage2D(o.TEXTURE_2D,f,0,t,i.width,n,d,s,0),Lv(o,`${r} mip ${f} band upload`)}f++}return{texture:c,estimatedBytes:cg(t,n,r),uvScale:[t/s.width,n/s.height]}}catch(e){throw c&&o.deleteTexture(c),this.failed.add(r),this.releaseWorkspace(),e}finally{Vv(o,s)}}releaseWorkspace(){let e=this.workspace;if(this.workspace=null,!e)return;let t=this.gl;t.deleteTexture(e.source),t.deleteTexture(e.output),t.deleteFramebuffer(e.framebuffer),t.deleteBuffer(e.buffer),t.deleteVertexArray(e.vao)}dispose(){this.releaseWorkspace(),this.releasePrograms(),this.gl.canvas?.removeEventListener?.(`webglcontextlost`,this.onContextLost)}releasePrograms(){for(let e of this.programs.values())this.gl.deleteProgram(e.program);this.programs.clear()}refreshContext(){return this.gl.isContextLost?.()?(this.onContextLost(),!1):(this.wasContextLost&&(this.wasContextLost=!1,this.failed.clear(),this.available=Pv(this.gl)),!0)}getProgram(e){let t=this.programs.get(e);if(t)return t;let n=this.gl,r=[],i=null;try{for(let[t,i]of[[n.VERTEX_SHADER,Mv],[n.FRAGMENT_SHADER,e===`bc7`?Av:jv]]){let e=Iv(n.createShader(t),`encoder shader`);if(r.push(e),n.shaderSource(e,i),n.compileShader(e),!n.getShaderParameter(e,n.COMPILE_STATUS))throw Error(n.getShaderInfoLog(e)??`Encoder shader compilation failed.`)}i=Iv(n.createProgram(),`encoder program`);for(let e of r)n.attachShader(i,e);if(n.linkProgram(i),!n.getProgramParameter(i,n.LINK_STATUS))throw Error(n.getProgramInfoLog(i)??`Encoder program linking failed.`);let t={program:i,source:Iv(n.getUniformLocation(i,`uSrc`),`source uniform`),size:Iv(n.getUniformLocation(i,`uSrcSize`),`size uniform`),flip:Iv(n.getUniformLocation(i,`uFlipY`),`flip uniform`)};return this.programs.set(e,t),t}catch(e){throw i&&n.deleteProgram(i),e}finally{for(let e of r)n.deleteShader(e)}}getWorkspace(e){let t=Math.min(Nv,Math.max(0,Math.floor(e)));if(this.workspace&&this.workspace.bytes<=t)return this.workspace;this.releaseWorkspace();let n=this.gl,r=Math.floor(Number(n.getParameter(n.MAX_TEXTURE_SIZE))/4)*4,i=r/4,a=r*4*4+i*16*2,o=Math.min(Math.floor(Number(n.getParameter(n.MAX_TEXTURE_SIZE))/4),Math.floor(t/a));if(o<1)throw Error(`Insufficient bounded workspace for one compressed block row.`);let s=null,c=null,l=null,u=null,d=null;try{if(s=Iv(n.createTexture(),`encoder source texture`),c=Iv(n.createTexture(),`encoder output texture`),l=Iv(n.createFramebuffer(),`encoder framebuffer`),u=Iv(n.createBuffer(),`encoder pixel buffer`),d=Iv(n.createVertexArray(),`encoder vertex array`),n.bindTexture(n.TEXTURE_2D,s),n.texStorage2D(n.TEXTURE_2D,1,n.RGBA8,r,o*4),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_MIN_FILTER,n.NEAREST),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_MAG_FILTER,n.NEAREST),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_WRAP_S,n.CLAMP_TO_EDGE),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_WRAP_T,n.CLAMP_TO_EDGE),n.bindTexture(n.TEXTURE_2D,c),n.texStorage2D(n.TEXTURE_2D,1,n.RGBA32UI,i,o),n.bindFramebuffer(n.FRAMEBUFFER,l),n.framebufferTexture2D(n.FRAMEBUFFER,n.COLOR_ATTACHMENT0,n.TEXTURE_2D,c,0),n.drawBuffers([n.COLOR_ATTACHMENT0]),n.checkFramebufferStatus(n.FRAMEBUFFER)!==n.FRAMEBUFFER_COMPLETE)throw Error(`Integer encoder framebuffer is incomplete.`);return n.bindBuffer(n.PIXEL_PACK_BUFFER,u),n.bufferData(n.PIXEL_PACK_BUFFER,i*o*16,n.STREAM_COPY),Lv(n,`encoder workspace allocation`),this.workspace={source:s,output:c,framebuffer:l,buffer:u,vao:d,width:r,blockRows:o,bytes:a*o}}catch(e){throw n.deleteTexture(s),n.deleteTexture(c),n.deleteFramebuffer(l),n.deleteBuffer(u),n.deleteVertexArray(d),e}}};function Iv(e,t){if(e==null)throw Error(`Unable to allocate ${t}.`);return e}function Lv(e,t){let n=e.getError();if(n!==e.NO_ERROR)throw Error(`${t} failed (WebGL error ${n}).`)}function Rv(e){return[e.PACK_ALIGNMENT,e.PACK_ROW_LENGTH,e.PACK_SKIP_PIXELS,e.PACK_SKIP_ROWS,e.UNPACK_ALIGNMENT,e.UNPACK_ROW_LENGTH,e.UNPACK_IMAGE_HEIGHT,e.UNPACK_SKIP_PIXELS,e.UNPACK_SKIP_ROWS,e.UNPACK_SKIP_IMAGES,e.UNPACK_FLIP_Y_WEBGL,e.UNPACK_PREMULTIPLY_ALPHA_WEBGL,e.UNPACK_COLORSPACE_CONVERSION_WEBGL]}function zv(e){let t=e.getParameter(e.ACTIVE_TEXTURE);return e.activeTexture(e.TEXTURE0),{activeTexture:t,texture:e.getParameter(e.TEXTURE_BINDING_2D),toggles:[e.BLEND,e.DEPTH_TEST,e.STENCIL_TEST,e.SCISSOR_TEST,e.CULL_FACE,e.DITHER,e.RASTERIZER_DISCARD].map(t=>[t,e.isEnabled(t)]),viewport:e.getParameter(e.VIEWPORT),colorMask:e.getParameter(e.COLOR_WRITEMASK),program:e.getParameter(e.CURRENT_PROGRAM),sampler:e.getParameter(e.SAMPLER_BINDING),vao:e.getParameter(e.VERTEX_ARRAY_BINDING),drawFramebuffer:e.getParameter(e.DRAW_FRAMEBUFFER_BINDING),readFramebuffer:e.getParameter(e.READ_FRAMEBUFFER_BINDING),pack:e.getParameter(e.PIXEL_PACK_BUFFER_BINDING),unpack:e.getParameter(e.PIXEL_UNPACK_BUFFER_BINDING),pixels:Rv(e).map(t=>[t,e.getParameter(t)])}}function Bv(e){for(let t of[e.BLEND,e.DEPTH_TEST,e.STENCIL_TEST,e.SCISSOR_TEST,e.CULL_FACE,e.DITHER,e.RASTERIZER_DISCARD])e.disable(t);e.colorMask(!0,!0,!0,!0),e.bindSampler(0,null),e.bindBuffer(e.PIXEL_UNPACK_BUFFER,null);for(let t of Rv(e))e.pixelStorei(t,t===e.PACK_ALIGNMENT||t===e.UNPACK_ALIGNMENT?1:t===e.UNPACK_COLORSPACE_CONVERSION_WEBGL?e.NONE:0)}function Vv(e,t){e.bindFramebuffer(e.DRAW_FRAMEBUFFER,t.drawFramebuffer),e.bindFramebuffer(e.READ_FRAMEBUFFER,t.readFramebuffer),e.bindBuffer(e.PIXEL_PACK_BUFFER,t.pack),e.bindBuffer(e.PIXEL_UNPACK_BUFFER,t.unpack);for(let[n,r]of t.pixels)e.pixelStorei(n,r);for(let[n,r]of t.toggles)r?e.enable(n):e.disable(n);e.viewport(t.viewport[0],t.viewport[1],t.viewport[2],t.viewport[3]),e.colorMask(t.colorMask[0],t.colorMask[1],t.colorMask[2],t.colorMask[3]),e.useProgram(t.program),e.bindVertexArray(t.vao),e.bindSampler(0,t.sampler),e.activeTexture(e.TEXTURE0),e.bindTexture(e.TEXTURE_2D,t.texture),e.activeTexture(t.activeTexture)}var Hv=`#version 300 es
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
`,Uv=`#version 300 es
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

${K_}

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
`;function Wv(e,t,n,r,i,a,o,s,c){if(!r)return null;let l=r({minX:0,minY:0,maxX:1,maxY:1});if(!l)return null;let u=i/o,d=a/s,f=c?-1:1;return Jv(e,t,n,[l.width*u,0,l.x*u,0,l.height*d*f,c?a-l.y*d:l.y*d,0,0,1])}var Gv=7,Kv=256;function qv(e,t,n){for(let r=t??-1,i=0;r>=0&&i<Kv;i++){if(r===n)return!0;r=e.clipPaths?.[r]?.parent??-1}return!1}function Jv(e,t,n,r){let i=t.first,a=e.gradientFillPaintMeta,o=e.gradientFillPathMetaA;if(t.kind!==`gradient-fill`||t.count!==1||!a||!o||!e.gradientFillPathMetaC||i<0||i*4+3>=a.length)return null;let s=a[i*4],c=s*4;if(!(s>=0&&s<e.gradientCount)||a[i*4+1]>=0)return null;let{gradientMetaA:l,gradientMetaB:u,gradientMetaC:d,gradientMetaD:f,gradientMetaE:p}=e;if(!l||!u||!d||!f||!p||c+3>=l.length||l[c]>1.5)return null;let m=[],h=[],g=e.gradientFillSegmentsA,_=e.gradientFillSegmentsB;for(let e=o[i*4],t=e+o[i*4+1];e<t;e++){let t=e*4;if(!g||!_||t+3>=g.length||_[t+2]>=1)return null;h.push(g[t],g[t+1],_[t],_[t+1])}m.push(h);let v=t.clipIndex??-1;if(v>=0&&!qv(e,n,v)){let t=e.clipPaths?.[v];if(!t||t.parent>=0&&!qv(e,n,t.parent))return null;m.push(Array.from(t.edges))}let y=(e,t)=>{let n=r[6]*e+r[7]*t+r[8];return n>1e-6?[(r[0]*e+r[1]*t+r[2])/n,(r[3]*e+r[4]*t+r[5])/n]:null},b=new Float32Array(60),x=Gv;for(let e of m){let t=[];for(let n=0;n<e.length;n+=4){let r=y(e[n],e[n+1]),i=(n+4)%e.length;if(!r||Math.hypot(e[n+2]-e[i],e[n+3]-e[i+1])>1e-5*(1+Math.abs(e[i])+Math.abs(e[i+1])))return null;t.push(r)}if(t.length<3)return null;let n=t.reduce((e,n)=>[e[0]+n[0]/t.length,e[1]+n[1]/t.length],[0,0]),r=0;for(let e=0;e<t.length;e++){let[n,i]=t[e],[a,o]=t[(e+1)%t.length],[s,c]=t[(e+2)%t.length],l=(a-n)*(c-o)-(o-i)*(s-a),u=Math.hypot(a-n,o-i)*Math.hypot(s-a,c-o);if(!(Math.abs(l)<=1e-6*u)){if(r&&Math.sign(l)!==r)return null;r=Math.sign(l)}}if(!r)return null;for(let e=0;e<t.length;e++){let[r,i]=t[e],[a,o]=t[(e+1)%t.length],s=Math.hypot(a-r,o-i);if(s<1e-9)continue;if(x>=15)return null;let c=(i-o)/s,l=(a-r)/s,u=-(c*r+l*i);c*n[0]+l*n[1]+u<0&&(c=-c,l=-l,u=-u),b.set([c,l,u,0],x++*4)}}for(;x<15;x++)b.set([0,0,1,0],x*4);let[S,C,w,T,E,D,O,k,A]=r,j=[E*A-D*k,w*k-C*A,C*D-w*E,D*O-T*A,S*A-w*O,w*T-S*D,T*k-E*O,C*O-S*k,S*E-C*T],M=S*j[0]+C*j[3]+w*j[6];if(!(Math.abs(M)>0)||!Number.isFinite(M))return null;for(let e=0;e<9;e++)j[e]/=M;let N=[...[0,1,2].map(e=>u[c]*j[e]+u[c+2]*j[e+3]+d[c]*j[e+6]),...[0,1,2].map(e=>u[c+1]*j[e]+u[c+3]*j[e+3]+d[c+1]*j[e+6]),...j.slice(6)],P=Math.max(...N.map(Math.abs));if(!(P>0)||!Number.isFinite(P))return null;for(let e=0;e<3;e++)b.set([N[e*3]/P,N[e*3+1]/P,N[e*3+2]/P,0],e*4);return b.set(l.subarray(c,c+4),12),b.set([d[c+2],d[c+3],f[c],f[c+1]],16),b.set([f[c+2],f[c+3],e.gradientFillPathMetaC[i*4+3],s],20),b.set(p.subarray(c,c+4),24),b}function Yv(e){let t=e===`wgsl`,n=e=>({F:`f32`,I:`i32`,V3:`vec3f`,V4:`vec4f`})[e]??e,r=e=>t?e.replace(/\b(F|I|V3|V4)\b/g,n):e.replace(/\bF\b/g,`float`).replace(/\bI\b/g,`int`).replace(/\bV3\b/g,`vec3`).replace(/\bV4\b/g,`vec4`),i=(e,n,i,a)=>{let o=n.split(`,`).map(e=>e.trim().split(` `));return r(t?`fn ${e}(${o.map(([e,t])=>`${t}: ${e}`).join(`, `)}) -> ${i} {${a}}`:`${i} ${e}(${n}) {${a}}`)},a=(e,n,r)=>t?`var ${n}: ${e} = ${r};`:`${e} ${n} = ${r};`;return[i(`pdfLum`,`V3 c`,`F`,`return dot(c, V3(0.3, 0.59, 0.11));`),i(`pdfSat`,`V3 c`,`F`,`return max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b);`),i(`pdfSetSat`,`V3 c, F s`,`V3`,`${a(`F`,`n`,`min(min(c.r,c.g),c.b)`)}${a(`F`,`d`,`pdfSat(c)`)}
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
`)}var Xv=`#version 300 es
precision highp float;
void main() {
  vec2 p=vec2(float((gl_VertexID << 1) & 2),float(gl_VertexID & 2));
  gl_Position=vec4(p*2.0-1.0,0.0,1.0);
}`,Zv=`#version 300 es
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
${Yv(`glsl`)}


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
}`,Qv=`
struct Params { p:vec4f, q:vec4f, backdrop:vec4f }
@group(0) @binding(0) var<uniform> params:Params;
@group(0) @binding(1) var sourceTex:texture_2d<f32>;
@group(0) @binding(2) var shapeTex:texture_2d<f32>;
@group(0) @binding(3) var currentTex:texture_2d<f32>;
@group(0) @binding(4) var statsTex:texture_2d<f32>;
@group(0) @binding(5) var initialTex:texture_2d<f32>;
@group(0) @binding(6) var maskTex:texture_2d<f32>;
@group(0) @binding(7) var transferTex:texture_2d<f32>;
${Yv(`wgsl`)}

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
}`,$v=7;function ey(e){if(!e)return[1,0,0,0,0];if(e.subtype!==`Luminosity`)return[0,0,0,1,0];let[t,n,r]=e.backdrop??[0,0,0],i=.3*t+.59*n+.11*r;return[.3,.59,.11,-i,i]}var ty=(Xn+Qn).replace(/heprGradient/g,`heprFoldGradient`),ny=(Zn+$n).replace(/heprGradient/g,`heprFoldGradient`);function ry(e,t=!1){let n=/void\s+main\s*\(\s*\)/;if(!n.test(e))throw Error(`Folded paint shader has no main function.`);let r=Array.from({length:8},(e,t)=>`  coverage *= clamp(0.5 + dot(uPaintMaskGradient[${$v+t}].xyz, p), 0.0, 1.0);`).join(`
`);return e.replace(n,`void heprUnfoldedPaint()`)+`
uniform vec4 uPaintFold;
uniform vec4 uPaintMaskWeights;
uniform vec4 uPaintMaskGradient[15];
uniform highp sampler2D uPaintMask;
${ty}
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
`}var iy=`
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
${Array.from({length:8},(e,t)=>`    coverage *= clamp(0.5 + dot(d${$v+t}.xyz, p), 0.0, 1.0);`).join(`
`)}
    var rgb = clamp(color.rgb, vec3f(0.0), vec3f(1.0));
    if (fold.y > 2.5) { rgb = select(pow((rgb + 0.055) / 1.055, vec3f(2.4)), rgb / 12.92, rgb <= vec3f(0.04045)); }
    let alpha = coverage * color.a;
    value = vec4f(rgb * alpha, alpha);
  }
  return fold.x * clamp(dot(value, weights) + fold.z, 0.0, 1.0);
}
`;function ay(e,t){let n=/@fragment\s+fn fsMain\(inData\s*:\s*(\w+)\)\s*->\s*@location\(0\)\s*vec4f/,r=e.match(n);if(!r)throw Error(`Folded paint shader has no supported fragment entry point.`);return e.replace(n,`fn heprUnfoldedPaint(inData: ${r[1]}) -> vec4f`)+`
struct HeprPaintFold { fold: vec4f, maskWeights: vec4f, gradient: array<vec4f, 15> };
${ny}
${iy}
@group(${t}) @binding(0) var<uniform> uPaintFold : HeprPaintFold;
@group(${t}) @binding(1) var uPaintMask : texture_2d<f32>;

@fragment
fn fsMain(inData: ${r[1]}) -> @location(0) vec4f {
  let color = heprUnfoldedPaint(inData);
  let fold = heprPaintFoldScale(inData.position.xy, uPaintMask, uPaintFold.fold, uPaintFold.maskWeights,
    ${Array.from({length:15},(e,t)=>`uPaintFold.gradient[${t}]`).join(`, `)});
  return vec4f(color.rgb, color.a * fold);
}
`}function oy(e,t,n){let r=1e-6;for(let i of[n.minX,n.maxX])for(let a of[n.minY,n.maxY]){let n=e[3]*i+e[7]*a+e[15];if(n<=1e-10)continue;let o=e[0]*i+e[4]*a+e[12],s=e[1]*i+e[5]*a+e[13],c=(e[0]*n-o*e[3])/(n*n)*t.width*.5,l=(e[4]*n-o*e[7])/(n*n)*t.width*.5,u=(e[1]*n-s*e[3])/(n*n)*t.height*.5,d=(e[5]*n-s*e[7])/(n*n)*t.height*.5,f=c*c+l*l+u*u+d*d,p=c*d-l*u,m=(f+Math.sqrt(Math.max(0,f*f-4*p*p)))*.5,h=Math.sqrt(m)/Math.max(1e-12,Math.abs(p));Number.isFinite(h)&&(r=Math.max(r,h))}return r}var sy=`#version 300 es
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
  vColor = aHighlightIndex < uSelectionCount ? vec3(${li.join(`,`)}) : vec3(${ui.join(`,`)});
  gl_Position = uLocalToClip * vec4(vLocal, 0.0, 1.0);
}
`,cy=`#version 300 es
precision highp float;
precision highp sampler2D;
uniform float uPixelRatio;
in vec2 vLocal;
flat in vec4 vSegmentA;
flat in vec4 vSegmentB;
flat in vec3 vColor;
out vec4 outColor;
${H_.replace(`int(uVectorClipIndex)`,`int(vSegmentB.w)`)}
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
`,ly=`
fn heprOffsetToLineSegment(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
  let ab = b - a;
  let abLenSq = dot(ab, ab);
  if (abLenSq <= 1e-10) {
    return a - p;
  }
  let t = clamp(dot(p - a, ab) / abLenSq, 0.0, 1.0);
  return a + ab * t - p;
}
`,uy=`
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
`,dy=`
fn heprPrimitiveHighlightCoverage(point: vec2<f32>, a: vec4<f32>, b: vec4<f32>, pixelRatio: f32) -> f32 {
  let offset = select(heprOffsetToLineSegment(point,a.xy,b.xy),heprOffsetToQuadraticBezier(point,a.xy,a.zw,b.xy),b.z >= 0.5);
  let distanceValue = length(offset);
  let axis = b.xy-a.xy;
  let fallback = select(vec2<f32>(1.0,0.0),vec2<f32>(-axis.y,axis.x)/max(length(axis),0.00000001),length(axis)>0.00000001);
  let normal = select(fallback,offset/max(distanceValue,0.00000001),distanceValue>0.00000001);
  let localPerPixel = max(length(vec2<f32>(dot(normal,dpdx(point)),dot(normal,dpdy(point)))),0.000001);
  return 1.0-smoothstep(max(0.0,pixelRatio-0.75)*localPerPixel,(pixelRatio+0.75)*localPerPixel,distanceValue);
}
`,fy=`
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
`,py=`
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
${ly}
${uy}
${dy}
${U_}
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
  out.color=select(vec3f(${ui.join(`,`)}),vec3f(${li.join(`,`)}),f32(instance)<uCamera.params.z);
  return out;
}
@fragment fn fsMain(inData: Output) -> @location(0) vec4f {
  let alpha=heprPrimitiveHighlightCoverage(inData.local,inData.a,inData.b,uCamera.params.y)*heprVectorClip(inData.local,inData.b.w,uClips);
  if(alpha<=0.001){discard;}
  return vec4f(inData.color,alpha);
}
`,my=new Set([`vP0`,`vP1`,`vP2`,`vPrimitiveType`,`vIsHairline`,`vHalfWidth`,`vAAWorld`,`vClipBounds`,`vHasClipBounds`,`vSegmentStart`,`vSegmentCount`,`vFillPathIndex`,`vFillOrigin`,`vFillBoundsMax`,`vFillSignedArea`,`vFillRule`,`vFillHasCompanionStroke`]);function hy(e,t){return e.replace(/^#version 300 es\s*/,``).replace(/void main\(\)/,`void ${t}()`).replace(/^(?:flat )?(?:in|out) (\w+) (\w+);$/gm,(e,t,n)=>my.has(n)?`${t} ${n} = ${t}(0);`:e)}function gy(e,t){let n=new Set;return`#version 300 es\nprecision highp float;\nprecision highp int;\n${e}\n${t}`.replace(/^(?:precision |uniform |(?:layout\([^\n]*\) )?(?:flat )?(?:in|out) )[^\n]*;$/gm,e=>n.has(e)?``:(n.add(e),e))}function _y(e){return e.replace(/vec4 heprThreeEncodeOutputColor\(vec4 color\) \{[^}]*\}/,``).replace(/float heprThreeLinearCoverageToOutputAlpha\(float coverage\) \{[^}]*\}/,``)}var vy=gy(hy(Y_,`heprMixedStrokeVertex`).replaceAll(`aSegmentIndex`,`aVectorIndex`),hy(Z_,`heprMixedFillVertex`).replace(`layout(location = 3)`,`layout(location = 1)`).replaceAll(`aFillPathIndex`,`aVectorIndex`))+`
layout(location = 5) in float aVectorKind;
uniform vec2 uMixedVectorEnabled;
flat out float vVectorKind;
flat out vec4 vMixedA;
flat out vec4 vMixedB;
flat out vec4 vMixedC;
flat out vec4 vMixedD;
flat out ivec3 vMixedSegments;

void main() {
  vVectorKind = aVectorKind;
  if ((aVectorKind < 0.5 ? uMixedVectorEnabled.x : uMixedVectorEnabled.y) < 0.5) {
    gl_Position = vec4(-2.0, -2.0, 0.0, 1.0);
    vLocal = vec2(0.0); vColor = vec3(0.0); vAlpha = 0.0;
    vVectorClipIndex = -1.0;
    vMixedA = vec4(0.0); vMixedB = vec4(0.0);
    vMixedC = vec4(0.0); vMixedD = vec4(0.0); vMixedSegments = ivec3(0);
    return;
  }
  if (aVectorKind < 0.5) {
    heprMixedStrokeVertex();
    vMixedA = vec4(vP0, vP1);
    vMixedB = vec4(vP2, vPrimitiveType, vIsHairline);
    vMixedC = vec4(vHalfWidth, vHasClipBounds, 0.0, 0.0);
    vMixedD = vClipBounds;
    vMixedSegments = ivec3(0);
  } else {
    heprMixedFillVertex();
    vMixedA = vec4(0.0);
    vMixedB = vec4(0.0);
    vMixedC = vec4(vFillOrigin, vFillRule, vFillSignedArea);
    vMixedD = vec4(vFillBoundsMax, 0.0, 0.0);
    vMixedSegments = ivec3(vSegmentStart, vSegmentCount, vFillPathIndex);
  }
}
`,yy=hy(X_,`heprMixedStrokeFragment`).replace(`length(vec2(dFdx(vLocal.x), dFdy(vLocal.x)))`,`heprMixedLocalPerPixel.x`).replace(`length(vec2(dFdx(vLocal.y), dFdy(vLocal.y)))`,`heprMixedLocalPerPixel.y`),by=_y(hy(Q_,`heprMixedFillFragment`).replace(G_,``)).replace(/\bpacked\b/g,`packedFillIndices`).replace(/vec2 footprint = max\(vec2\(\s*length\(vec2\(dFdx\(vLocal.x\), dFdy\(vLocal.x\)\)\),\s*length\(vec2\(dFdx\(vLocal.y\), dFdy\(vLocal.y\)\)\)\s*\) \* uFillAAScreenPx, vec2\(1e-4\)\);/,`vec2 footprint = max(heprMixedLocalPerPixel * uFillAAScreenPx, vec2(1e-4));`),xy=gy(`vec2 heprMixedLocalPerPixel = vec2(0.0);\n${yy}`,by)+`
flat in float vVectorKind;
flat in vec4 vMixedA;
flat in vec4 vMixedB;
flat in vec4 vMixedC;
flat in vec4 vMixedD;
flat in ivec3 vMixedSegments;

void main() {
  
  heprMixedLocalPerPixel = vec2(
    length(vec2(dFdx(vLocal.x), dFdy(vLocal.x))),
    length(vec2(dFdx(vLocal.y), dFdy(vLocal.y)))
  );
  if (vVectorKind < 0.5) {
    vP0 = vMixedA.xy;
    vP1 = vMixedA.zw;
    vP2 = vMixedB.xy;
    vPrimitiveType = vMixedB.z;
    vIsHairline = vMixedB.w;
    vHalfWidth = vMixedC.x;
    vHasClipBounds = vMixedC.y;
    vClipBounds = vMixedD;
    heprMixedStrokeFragment();
  } else {
    vFillOrigin = vMixedC.xy;
    vFillRule = vMixedC.z;
    vFillSignedArea = vMixedC.w;
    vFillBoundsMax = vMixedD.xy;
    vSegmentStart = vMixedSegments.x;
    vSegmentCount = vMixedSegments.y;
    vFillPathIndex = vMixedSegments.z;
    heprMixedFillFragment();
  }
}
`;function Sy(e){let t=null,n=!1,r=0,i=0,a=new Set,o=new Map,s=null,c=!1,l=0,u=0,d=0;function f(){n=!1,r=0,i=0,a.clear(),o.clear(),s=null,c=!1,l=0,u=0,d=0}function p(){o.clear(),s=null,c=!1,l=0,u=0,d=0}function m(t){t&&n&&e().endPanInteraction(),p(),f()}function h(){if(o.size<2)return null;let e=o.values(),t=e.next().value,n=e.next().value;if(!t||!n)return null;let r=n.x-t.x,i=n.y-t.y;return{distance:Math.hypot(r,i),centerX:(t.x+n.x)*.5,centerY:(t.y+n.y)*.5}}function g(e,t){if(e.hasPointerCapture(t))try{e.releasePointerCapture(t)}catch{}}function _(t){if(!o.has(t.pointerId)||!n)return;o.set(t.pointerId,{x:t.clientX,y:t.clientY});let a=e();if(o.size>=2){let e=h();if(!e)return;if(!c){c=!0,s=null,l=Math.max(e.distance,.001),u=e.centerX,d=e.centerY;return}let t=Math.max(l,.001),n=Math.max(e.distance,.001),r=n/t,i=e.centerX-u,o=e.centerY-d;(i!==0||o!==0)&&a.panByPixels(i,o),Number.isFinite(r)&&Math.abs(r-1)>1e-4&&a.zoomAtClientPoint(e.centerX,e.centerY,r),l=n,u=e.centerX,d=e.centerY;return}if(s===null){s=t.pointerId,r=t.clientX,i=t.clientY,c=!1,l=0;return}if(t.pointerId!==s)return;let f=t.clientX-r,p=t.clientY-i;r=t.clientX,i=t.clientY,a.panByPixels(f,p)}function v(e,t){if(o.delete(t.pointerId),a.delete(t.pointerId),g(e,t.pointerId),o.size>=2){let e=h();e&&(c=!0,s=null,l=Math.max(e.distance,.001),u=e.centerX,d=e.centerY);return}if(o.size===1){let e=o.entries().next().value;e?(s=e[0],r=e[1].x,i=e[1].y):s=null,c=!1,l=0,u=0,d=0;return}m(!0)}let y=f=>{let p=t;if(p){if(a.add(f.pointerId),n||(n=!0,e().beginPanInteraction()),f.pointerType===`touch`){if(o.set(f.pointerId,{x:f.clientX,y:f.clientY}),o.size===1)s=f.pointerId,c=!1,l=0,u=f.clientX,d=f.clientY,r=f.clientX,i=f.clientY;else{let e=h();e&&(c=!0,s=null,l=Math.max(e.distance,.001),u=e.centerX,d=e.centerY)}}else r=f.clientX,i=f.clientY;p.setPointerCapture(f.pointerId)}},b=t=>{if(t.pointerType===`touch`){_(t);return}if(!n)return;let a=t.clientX-r,o=t.clientY-i;r=t.clientX,i=t.clientY,e().panByPixels(a,o)},x=e=>{let n=t;if(n){if(e.pointerType===`touch`){v(n,e);return}a.delete(e.pointerId),m(!0),g(n,e.pointerId)}},S=e=>{let n=t;if(n){if(e.pointerType===`touch`){v(n,e);return}a.delete(e.pointerId),m(!0),g(n,e.pointerId)}},C=e=>{if(a.delete(e.pointerId),e.pointerType===`touch`){o.has(e.pointerId)&&o.delete(e.pointerId),o.size===0&&m(!0);return}n&&m(!0)},w=t=>{t.preventDefault();let n=Math.exp(-t.deltaY*.0013);e().zoomAtClientPoint(t.clientX,t.clientY,n)};function T(e){t!==e&&(t&&E(),t=e,e.addEventListener(`pointerdown`,y),e.addEventListener(`pointermove`,b),e.addEventListener(`pointerup`,x),e.addEventListener(`pointercancel`,S),e.addEventListener(`lostpointercapture`,C),e.addEventListener(`wheel`,w,{passive:!1}))}function E(){let e=t;if(e){for(let t of a)g(e,t);e.removeEventListener(`pointerdown`,y),e.removeEventListener(`pointermove`,b),e.removeEventListener(`pointerup`,x),e.removeEventListener(`pointercancel`,S),e.removeEventListener(`lostpointercapture`,C),e.removeEventListener(`wheel`,w),t=null,m(!0)}}function D(){let e=t;if(e)for(let t of a)g(e,t);m(!0)}return{attach:T,detach:E,resetState:f,cancelActiveGesture:D}}var Cy=/^[a-z][a-z\d+.-]*:/i;function wy(e){let t=e.trim();if(Cy.test(t))return t;let n=t.replace(/^\/+/,``),r=new URL(`./`,window.location.href);return new URL(n,r).toString()}function Ty(e){let t=Array.isArray(e.examples)?e.examples:[],n=[];for(let e=0;e<t.length;e+=1){let r=t[e],i=Dy(r?.name);if(!i)continue;let a=Dy(r?.id)??`example-${e+1}`,o=Dy(r?.pdf?.path),s=Dy(r?.hep?.path),c=o?wy(o):null,l=s?wy(s):null;c&&l&&n.push({id:a,name:i,pdfPath:c,pdfSizeBytes:Ey(r?.pdf?.sizeBytes,0),hepPath:l,hepSizeBytes:Ey(r?.hep?.sizeBytes,0)})}return n}function Ey(e,t){let n=Number(e);return Number.isFinite(n)?Math.max(0,Math.trunc(n)):Math.max(0,Math.trunc(t))}function Dy(e){if(typeof e!=`string`)return null;let t=e.trim();return t.length>0?t:null}var Oy=16,ky=6;function Ay(e){let{containerElement:t,triggerElement:n,labelElement:r,menuElement:i,onSelect:a,signal:o}=e,s=o?{signal:o}:void 0,c=!1,l=!1,u=!1;i.tabIndex=-1,document.body.append(i);function d(e){return t.contains(e)||i.contains(e)}function f(){let e=l||!c;n.disabled=e,e&&m()}function p(){u||n.disabled||(u=!0,i.hidden=!1,h(),t.classList.add(`open`),n.setAttribute(`aria-expanded`,`true`),i.focus({preventScroll:!0}))}function m(e=!1){u&&(u=!1,i.hidden=!0,t.classList.remove(`open`),n.setAttribute(`aria-expanded`,`false`),e&&n.focus())}function h(){let e=n.getBoundingClientRect();i.style.minWidth=`${Math.round(e.width)}px`,i.style.top=`${Math.round(e.bottom+ky)}px`,i.style.left=`${Math.round(e.left)}px`;let t=window.innerHeight-e.bottom-ky-Oy;i.style.maxHeight=`${Math.max(160,t)}px`;let r=i.getBoundingClientRect(),a=r.right-(window.innerWidth-Oy);a>0&&(i.style.left=`${Math.max(Oy,Math.round(r.left-a))}px`)}function g(){return Array.from(i.querySelectorAll(`button.example-chip`))}function _(e){let t=g();if(t.length===0)return;let n=t.indexOf(document.activeElement);t[n===-1?e>0?0:t.length-1:(n+e+t.length)%t.length].focus()}n.addEventListener(`click`,()=>{u?m():p()},s),n.addEventListener(`keydown`,e=>{(e.key===`ArrowDown`||e.key===`ArrowUp`)&&(e.preventDefault(),p(),_(e.key===`ArrowDown`?1:-1))},s),i.addEventListener(`keydown`,e=>{if(e.key===`Escape`)e.preventDefault(),m(!0);else if(e.key===`ArrowDown`||e.key===`ArrowUp`)e.preventDefault(),_(e.key===`ArrowDown`?1:-1);else if(e.key===`Home`||e.key===`End`){e.preventDefault();let t=g();t[e.key===`Home`?0:t.length-1]?.focus()}},s);let v=e=>{let t=e.relatedTarget;t instanceof Node&&d(t)||m()};t.addEventListener(`focusout`,v,s),i.addEventListener(`focusout`,v,s),document.addEventListener(`pointerdown`,e=>{u&&e.target instanceof Node&&!d(e.target)&&m()},s),window.addEventListener(`resize`,()=>{m()},s),window.addEventListener(`scroll`,e=>{u&&e.target instanceof Node&&!i.contains(e.target)&&m()},{capture:!0,passive:!0,...o?{signal:o}:{}});function y(e){c=!1,r.textContent=e,i.replaceChildren(),f()}function b(e){if(c=e.length>0,r.replaceChildren(),r.append(`Examples`),c){let t=document.createElement(`span`);t.className=`example-trigger-count`,t.textContent=String(e.length),r.append(t)}let t=[];for(let n of e){let e=document.createElement(`div`);e.className=`example-menu-row`;let r=document.createElement(`span`);r.className=`example-menu-name`,r.textContent=n.name,r.title=n.name,e.append(r);let i=document.createElement(`div`);i.className=`example-menu-actions`;for(let e of n.actions){let t=document.createElement(`button`);t.type=`button`,t.className=`example-chip`,t.title=e.title;let n=document.createElement(`span`);n.className=`example-chip-kind`,n.textContent=e.label;let r=document.createElement(`span`);r.className=`example-chip-size`,r.textContent=e.sizeLabel,t.append(n,r),t.addEventListener(`click`,()=>{m(),a(e.key)}),i.append(t)}e.append(i),t.push(e)}i.replaceChildren(...t),f()}function x(e){l=e,f()}return{setPlaceholder:y,setItems:b,setDisabled:x,close:()=>m()}}var jy=.12,My=jy*.5,Ny=.5,Py=.5,Fy=.98,Iy=4;function Ly(e,t,n,r,i){let a=t.charInstance[n];if(a===-1||a===void 0)return!1;if(a<=-2){let e=(-a-2)*4,n=t.fallbackQuads;return e+3>=n.length?!1:(r[i]=n[e],r[i+1]=n[e+1],r[i+2]=n[e+2],r[i+3]=n[e+3],!0)}let o=e.textInstanceA,s=e.textInstanceB,c=e.textGlyphMetaA,l=e.textGlyphMetaB,u=a*4;if(u+3>=o.length||u+3>=s.length)return!1;let d=o[u],f=o[u+1],p=o[u+2],m=o[u+3],h=s[u],g=s[u+1],_=Math.trunc(s[u+2])*4;if(_<0||_+3>=c.length||_+1>=l.length)return!1;let v=c[_+2],y=c[_+3],b=l[_],x=l[_+1],S=d*v+p*y+h,C=f*v+m*y+g,w=d*v+p*x+h,T=f*v+m*x+g,E=d*b+p*y+h,D=f*b+m*y+g,O=d*b+p*x+h,k=f*b+m*x+g;r[i]=Math.min(S,w,E,O),r[i+1]=Math.min(C,T,D,k),r[i+2]=Math.max(S,w,E,O),r[i+3]=Math.max(C,T,D,k);let A=Math.trunc(s[u+3]),j=(A-1)*4;return!(A>0&&e.textClipRects&&j+3<e.textClipRects.length&&(r[i]=Math.max(r[i],e.textClipRects[j]),r[i+1]=Math.max(r[i+1],e.textClipRects[j+1]),r[i+2]=Math.min(r[i+2],e.textClipRects[j+2]),r[i+3]=Math.min(r[i+3],e.textClipRects[j+3]),r[i]>r[i+2]||r[i+1]>r[i+3]))}var Ry=new Float32Array(4),zy=new Float64Array(4);function By(e,t,n,r){let i=t.charInstance[n];if(i===void 0||i<0)return!1;let a=i*4;if(a+1>=e.textInstanceA.length||a+1>=e.textInstanceB.length)return!1;let o=e.textInstanceA[a],s=e.textInstanceA[a+1],c=Math.hypot(o,s);return!Number.isFinite(c)||c<=1e-12?!1:(r[0]=e.textInstanceB[a],r[1]=e.textInstanceB[a+1],r[2]=o/c,r[3]=s/c,Number.isFinite(r[0])&&Number.isFinite(r[1]))}function Vy(e,t,n){return t*(t>=0?e.minX:e.maxX)+n*(n>=0?e.minY:e.maxY)}function Hy(e,t,n){return t*(t>=0?e.maxX:e.minX)+n*(n>=0?e.maxY:e.minY)}function Uy(e,t,n){return Hy(e,t,n)-Vy(e,t,n)}function Wy(e,t,n,r){return Math.min(t,r)-Math.max(e,n)>=Math.min(t-e,r-n)*Ny}function Gy(e,t,n,r){return Wy(Vy(e,n,r),Hy(e,n,r),Vy(t,n,r),Hy(t,n,r))}function Ky(e,t,n){if(n)return!1;if(Gy(e,t,1,0)||Gy(e,t,0,1))return!0;let r=(t.minX+t.maxX-e.minX-e.maxX)*.5,i=(t.minY+t.maxY-e.minY-e.maxY)*.5,a=Math.hypot(e.maxX-e.minX,e.maxY-e.minY),o=Math.hypot(t.maxX-t.minX,t.maxY-t.minY);return Math.hypot(r,i)<=Math.max(a,o,1e-6)*Iy}function qy(e,t,n,r){let i=e.maxX-e.minX,a=e.maxY-e.minY;if(i<=0||a<=0){let t=.5;return{minX:e.minX-t,minY:e.minY-t,maxX:e.maxX+t,maxY:e.maxY+t}}let o,s;if(t!==null&&n!==null&&Number.isFinite(r)&&r>0){let e=-n,i=t,a=r*My,c=r*jy;o=Math.abs(t)*a+Math.abs(e)*c,s=Math.abs(n)*a+Math.abs(i)*c}else s=a*jy,o=a*My;return{minX:e.minX-o,minY:e.minY-s,maxX:e.maxX+o,maxY:e.maxY+s}}function Jy(e,t,n,r){let i=[],a=null,o=null,s=!1,c=!1,l=0,u=0,d=0,f=0,p=0,m=0,h=!1,g=(e,t)=>{s=!0,c=!0,l=zy[2],u=zy[3];let n=-u,r=l;d=n*zy[0]+r*zy[1],f=Vy(e,n,r),p=Hy(e,n,r),m=Uy(e,n,r),t&&(f=Math.min(f,Vy(t,n,r)),p=Math.max(p,Hy(t,n,r)),m=Math.max(m,Uy(t,n,r)))},_=(e,t)=>{let n=(t.minX+t.maxX-e.minX-e.maxX)*.5,r=(t.minY+t.maxY-e.minY-e.maxY)*.5,i=Math.hypot(n,r);if(!Number.isFinite(i)||i<=1e-12)return;s=!0,c=!1,l=n/i,u=r/i;let a=-u,o=l;f=Math.min(Vy(e,a,o),Vy(t,a,o)),p=Math.max(Hy(e,a,o),Hy(t,a,o)),m=Math.max(Uy(e,a,o),Uy(t,a,o))},v=e=>{let t=-u,n=l;f=Math.min(f,Vy(e,t,n)),p=Math.max(p,Hy(e,t,n)),m=Math.max(m,Uy(e,t,n))},y=()=>{a&&(i.push(qy(a,s?l:null,s?u:null,m)),a=null,o=null,s=!1,c=!1,m=0)},b=Math.min(n+r,t.charInstance.length);for(let r=Math.max(0,n);r<b;r+=1){if(!Ly(e,t,r,Ry,0)){t.charInstance[r]===-1&&(h=!0);continue}let n=Ry[0],i=Ry[1],b=Ry[2],x=Ry[3],S={minX:n,minY:i,maxX:b,maxY:x},C=By(e,t,r,zy);if(a){let e;if(s){let t=-u,n=l,r=Vy(S,t,n),i=Hy(S,t,n);if(C){let a=Math.abs(zy[2]*l+zy[3]*u);if(c){let o=t*zy[0]+n*zy[1],s=i-r,c=Math.min(s,m)*Py;e=a>=Fy&&Math.abs(o-d)<=c}else e=a>=Fy&&Wy(f,p,r,i)}else e=Wy(f,p,r,i)}else e=o!==null&&Ky(o,S,h);e||y()}if(!a){a=S,o=S,C&&g(S,null),h=!1;continue}s?v(S):C?g(S,o):o&&_(o,S),a.minX=Math.min(a.minX,n),a.minY=Math.min(a.minY,i),a.maxX=Math.max(a.maxX,b),a.maxY=Math.max(a.maxY,x),o=S,h=!1}return y(),i}var Yy=new WeakMap;function Xy(e,t,n,r){if(!e.optionalContent&&!e.paintGraph)return!0;!r&&e.optionalContent&&(r=Yy.get(e),r||Yy.set(e,r=l(e)));let i=e=>e===void 0||e<0||!r||r.conditions[e]===1,a=t.charInstance[n];if(e.paintGraph&&a>=0&&!yr(e,{kind:`text`,index:a},i))return!1;let o=t.optionalContent?.[n];return o===void 0&&(o=a>=0?vr(e,{kind:`text`,index:a}):void 0),i(o)}var Zy=5e3,Qy=96,$y=40,eb=12;function tb(e){return e.highlightBounds&&e.highlightBounds.length>0?e.highlightBounds:[e.bounds]}function nb(e,t=-1){let n=t>=0&&t<e.length?t:-1,r=[],i=-1,a=0;for(let t=0;t<e.length;t+=1){let o=tb(e[t]);t===n&&(i=r.length,a=o.length),r.push(...o)}return{bounds:r,currentIndex:i,currentCount:a}}function rb(e,t=-1){if(e.length===0)return null;let n=nb(e,t),r=n.bounds.length;if(r===0)return null;let i=new Float32Array(r*4);for(let e=0;e<r;e+=1){let t=n.bounds[e],r=e*4;i[r]=t.minX,i[r+1]=t.minY,i[r+2]=t.maxX,i[r+3]=t.maxY}return{rects:i,count:r,currentIndex:n.currentIndex,currentCount:n.currentCount}}function ib(e){if(e.length===0)return{minX:0,minY:0,maxX:0,maxY:0};let t=e[0].minX,n=e[0].minY,r=e[0].maxX,i=e[0].maxY;for(let a=1;a<e.length;a+=1)t=Math.min(t,e[a].minX),n=Math.min(n,e[a].minY),r=Math.max(r,e[a].maxX),i=Math.max(i,e[a].maxY);return{minX:t,minY:n,maxX:r,maxY:i}}function ab(e){let t=e.textIndex?.pages??[],n=t.some(e=>e.text.length>0),r=null,i=()=>(r||=t.map(e=>sb(e.text)),r);return{hasText:n,search(r,a={}){let o=[];if(!n)return o;let s=a.caseSensitive===!0,c=Math.max(1,a.maxMatches??Zy),l=r.replace(/\s+/g,` `);if(l.trim().length===0)return o;let u=s?l:sb(l),d=s?t.map(e=>e.text):i();for(let n=0;n<d.length;n+=1){let r=d[n];if(r.length<u.length)continue;let i=0;for(;o.length<c;){let s=r.indexOf(u,i);if(s<0)break;let c=!0;for(let r=s;r<s+u.length;r++)if(!Xy(e,t[n],r,a.optionalContent)){c=!1;break}if(!c){i=s+Math.max(1,u.length);continue}let l=Jy(e,t[n],s,u.length);o.push({pageIndex:n,startChar:s,length:u.length,bounds:ib(l),highlightBounds:l}),i=s+u.length}if(o.length>=c)break}return o}}}function ob(e){let t=null,n=!1,r=!1,i=``,a=!1,o=[],s=!1,c=-1,l=()=>({hasScene:n,hasTextIndex:r,query:i,caseSensitive:a,matchCount:o.length,matchCountCapped:s,currentIndex:c}),u=()=>{e.onStateChange(l()),e.onMatchesChange(c>=0?o[c]:null,o)},d=()=>{o=t?t.search(i,{caseSensitive:a,maxMatches:Zy,optionalContent:e.getRenderer()?.getOptionalContentVisibility?.()}):[],s=o.length>=Zy},f=()=>{if(o.length===0)return-1;let t=e.getRenderer();if(!t)return 0;let n=t.getViewState(),r=0,i=1/0;for(let e=0;e<o.length;e+=1){let t=o[e].bounds,a=(t.minX+t.maxX)*.5-n.cameraCenterX,s=(t.minY+t.maxY)*.5-n.cameraCenterY,c=a*a+s*s;c<i&&(i=c,r=e)}return r},p=t=>{let n=e.getRenderer(),r=e.getCanvas();if(!n||!r)return;let i=t.bounds,a=window.devicePixelRatio||1,o=Math.max(i.maxX-i.minX,1e-4),s=Math.max(i.maxY-i.minY,1e-4),c=Qy*a,l=Math.max(1,r.width-c*2),u=Math.max(1,r.height-c*2),d=Math.min(l/o,u/s),f=$y*a/s,p=Math.min(d,f),m=n.getViewState(),h=o*m.zoom<=l&&s*m.zoom<=u,g=s*m.zoom/a>=eb,_=h&&g?m.zoom:p,v={cameraCenterX:(i.minX+i.maxX)*.5,cameraCenterY:(i.minY+i.maxY)*.5,zoom:_};e.navigateToView?e.navigateToView(v):n.setViewState(v)},m=e=>{d(),c=f(),e&&c>=0&&p(o[c]),u()},h=e=>{o.length!==0&&(c=(c+e+o.length)%o.length,p(o[c]),u())};return{setScene(e){n=e!==null,t=e?ab(e):null,r=t?.hasText===!0,m(!1)},refreshVisibility(){m(!1)},setQuery(e){e!==i&&(i=e,m(!0))},setCaseSensitive(e){e!==a&&(a=e,m(!0))},next(){h(1)},prev(){h(-1)},clear(){i=``,o=[],s=!1,c=-1,u()},getState:l,getCurrentMatch(){return c>=0?o[c]:null}}}function sb(e){let t=``;for(let n=0;n<e.length;n+=1){let r=e[n],i=r.toLowerCase();t+=i.length===1?i:r}return t}function cb(e,t){let n=!1,r=null,i=null,a=null,o=new Map,s=null,c=null,l=null,u=null,d=null,f=0,p=null,m=``,h=!1,g=0,_=new Map;function v(e){s!==e&&(s=e,t.onPreparationProgress?.(e))}function y(t){e.setHover(t),r?.classList.toggle(`drawing-selection-hover`,t!==null)}function b(){let e=a&&i?Br(i,a):null,n=a?o.get(di(a))?.color??e?.color:null;t.onSelectionChange?.(e,n?[...n]:null)}function x(){let t=e.getCanvas(),n=t.getBoundingClientRect();return`${e.getViewKey()}:${t.width}:${t.height}:${n.left}:${n.top}:${n.width}:${n.height}`}function S(){return u?.select?u:c&&!c.signal.aborted&&l?.select?l:null}function C(){f++,u=null,c?.abort(),d!==null&&cancelAnimationFrame(d),d=null}function w(){C(),r?.classList.remove(`drawing-selection-hover`),_.clear(),h=!1,p=null,v(null),a=null,o.clear(),i=e.getScene();let s=i,c=++g;e.sceneChanged(t=>{n&&c===g&&i===s&&e.getScene()===s&&v(t)}),t.onSelectionChange?.(null),m=x()}function T(e,t){if(n&&i&&(t||!u?.select)){if(!t&&c&&!c.signal.aborted&&l?.select){u={point:e,select:!1};return}f++,c?.abort(),u={point:e,select:t},d===null&&!c&&(d=requestAnimationFrame(()=>{d=null,E()}))}}async function E(){if(!n||!i||!u||c)return;let r=u;u=null;let o=f,s=i,m=e.getTarget(),h=x(),g=new AbortController;c=g,l=r;try{let t=await e.pick(r.point,g.signal);if(g.signal.aborted||o!==f||!n||s!==e.getScene()||m!==e.getTarget())return;if(h!==x()){T(r.point,r.select);return}let i=p?.x===r.point.x&&p?.y===r.point.y;y(i?t?.primitive??null:null),r.select&&(a=t?{...t.primitive}:null,e.setSelection(a?[a]:[]),b(),p&&!i&&!u&&(u={point:p,select:!1}))}catch(e){!g.signal.aborted&&!(e instanceof DOMException&&e.name===`AbortError`)&&t.onError?.(e)}finally{c===g&&(c=null,l=null),n&&u&&d===null&&(d=requestAnimationFrame(()=>{d=null,E()}))}}let D=e=>{if(e.button===0||e.pointerType===`touch`){if(C(),_.set(e.pointerId,{x:e.clientX,y:e.clientY,moved:!1}),_.size>1)for(let e of _.values())e.moved=!0;h=!0,y(null)}},O=e=>{p={x:e.clientX,y:e.clientY};let t=_.get(e.pointerId);t&&Math.hypot(e.clientX-t.x,e.clientY-t.y)>4&&(t.moved=!0),!_.size&&e.buttons===0&&e.pointerType!==`touch`&&T(p,!1)},k=e=>{let t=_.get(e.pointerId);_.delete(e.pointerId),h=_.size>0,p=e.pointerType===`touch`?null:{x:e.clientX,y:e.clientY},t&&!t.moved&&!_.size&&Math.hypot(e.clientX-t.x,e.clientY-t.y)<=4&&T({x:e.clientX,y:e.clientY},!0)},A=()=>{_.clear(),h=!1,C(),M()},j=e=>{_.has(e.pointerId)&&A()},M=()=>{p=null,S()?u&&!u.select&&(u=null):C(),y(null)},N=n=>{n.key===`Escape`&&(C(),y(null),a=null,e.setSelection([]),t.onSelectionChange?.(null))};function P(){r&&(r.classList.remove(`drawing-selection-hover`),r.removeEventListener(`pointerdown`,D),r.removeEventListener(`pointermove`,O),r.removeEventListener(`pointerup`,k),r.removeEventListener(`pointercancel`,A),r.removeEventListener(`lostpointercapture`,j),r.removeEventListener(`pointerleave`,M),r.ownerDocument.removeEventListener(`keydown`,N),r=null,_.clear(),h=!1)}function ee(){let t=e.getCanvas();r!==t&&(P(),r=t,r.classList.remove(`drawing-selection-hover`),r.addEventListener(`pointerdown`,D),r.addEventListener(`pointermove`,O),r.addEventListener(`pointerup`,k),r.addEventListener(`pointercancel`,A),r.addEventListener(`lostpointercapture`,j),r.addEventListener(`pointerleave`,M),r.ownerDocument.addEventListener(`keydown`,N))}function F(){n=!1,C(),P(),e.dispose(),v(null),a=null,o.clear(),g++,p=null,i=null,t.onSelectionChange?.(null)}return{enable(){n||(n=!0,w(),ee())},disable:F,isEnabled:()=>n,setSelectedColor(t){if(a){let n=fi(t);e.setOverrides([a],n),o.set(di(a),{ref:{...a},color:n})}b()},resetSelectedColor(){a&&(e.clearOverrides([a]),o.delete(di(a))),b()},resetAllColors(){e.clearOverrides(),o.clear(),b()},sceneChanged(){n&&w()},rendererChanged(){if(n){if(i!==e.getScene()){w(),ee();return}C(),p=null,_.clear(),h=!1,ee(),e.rendererChanged(),y(null);for(let{ref:t,color:n}of o.values())e.setOverrides([t],n);e.setSelection(a?[a]:[]),m=x()}},onFrame(){if(!n)return;i!==e.getScene()&&w(),r!==e.getCanvas()&&ee();let t=x();if(t!==m){m=t;let n=S();C(),y(null),a&&e.isVisible?.(a)===!1&&(a=null,e.setSelection([]),b()),n&&!h?T(n.point,!0):p&&!h&&T(p,!1)}},dispose:F}}function lb(e){let t=null,n=null,r=null,i=null,a=()=>{},o=!1,s=()=>{i?.dispose(),i=null,o=t!==e.getScene(),r?.dispose(),r=null,o=!1};return cb({isVisible(n){return!!t&&yr(t,n,t=>t===void 0||e.getRenderer().getOptionalContentVisibility?.()?.conditions[t]!==0)},getCanvas:e.getCanvas,getScene:e.getScene,getTarget:e.getRenderer,getViewKey:()=>{let t=e.getRenderer().getViewState();return`${t.cameraCenterX}:${t.cameraCenterY}:${t.zoom}:${e.getRenderer().getOptionalContentVisibility?.()?.revision??0}`},async pick(n,o){if(!t)return null;let s=e.getRenderer(),c=s.clientToScenePoint?.(n.x,n.y)??null,l=e.getCanvas().getBoundingClientRect();if(!c||n.x<l.left||n.x>l.right||n.y<l.top||n.y>l.bottom)return null;i??=new ci(t,e=>a(e));let u=s.getOptionalContentVisibility?.(),d=await i.pick({point:c,clientPoint:n,project:e=>s.sceneToClientPoint?.(e.x,e.y)??null,unproject:e=>s.clientToScenePoint?.(e.x,e.y)??null,tolerancePx:4,signal:o,rasterLayers:s.getRasterLayerUpdates?.(),resolveColor(e,t){let n=r?.getOverrideColor(e)??t,i=s.getVectorColorOverride?.();return i?n.map((e,t)=>e*(1-i[3])+i[t]*i[3]):n},...u?{isConditionVisible:e=>e===void 0||u.conditions[e]!==0}:{}});if(u!==s.getOptionalContentVisibility?.())throw new DOMException(`Layer visibility changed during picking.`,`AbortError`);return d},setHover:e=>r?.setHover(e),setSelection:e=>r?.setSelection(e),setOverrides:(e,t)=>r?.setOverrides(e,{color:t}),clearOverrides:e=>r?.clearOverrides(e),sceneChanged(i){s(),t=e.getScene(),n=e.getRenderer(),a=i,n.setPrimitiveHighlights?.(null),t&&(r=new pi(t,{onColors:e=>{o||n?.setPrimitiveColorUpdates?.(e)},onHighlights:e=>{o||n?.setPrimitiveHighlights?.(e)}}))},rendererChanged(){n=e.getRenderer(),n.setPrimitiveColorUpdates?.(r?.getColorUpdates()??[]),n.setPrimitiveHighlights?.(r?.getHighlights()??null)},dispose:s},e)}function ub(e){let{container:t}=e;t.innerHTML=`
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
    </div>`;let n=e=>t.querySelector(`#drawing-selection-${e}`),r=n(`checkbox`),i=n(`controls`),a=n(`loading`),o=n(`loading-label`),s=n(`progress`),c=n(`info`),l=n(`color`),u=n(`reset`),d=n(`reset-all`),f=!1;r.checked=!1;let p=e.createController({onPreparationProgress:e=>{if(f)return;let t=e!==null&&e<100;a.hidden=!t,c.hidden=t,s.value=e??0,o.textContent=`Preparing drawing selection… ${e??0}%`,i.setAttribute(`aria-busy`,String(t))},onSelectionChange:(t,n)=>{if(f)return;let r=t!==null&&t.kind!==`raster`;if(l.disabled=u.disabled=!r,!t){c.textContent=`Hover or click a drawing element.`;return}let i=t.pageIndex===null?``:` · Page ${t.pageIndex+1}`,a=t.bounds;c.textContent=`${t.kind} ${t.index}${i} · ${t.segmentCount} segments · (${a.minX.toFixed(2)}, ${a.minY.toFixed(2)})–(${a.maxX.toFixed(2)}, ${a.maxY.toFixed(2)})`;let o=t.optionalContent?.layerIds;o?.length&&(c.textContent+=` · Layers: ${o.map(t=>{let n=e.getLayerName?.(t);return n?`${n} (${t})`:t}).join(`, `)}`);let s=n??t.color??[1,0,0];l.value=`#`+s.map(e=>Math.round(Math.max(0,Math.min(1,e))*255).toString(16).padStart(2,`0`)).join(``)}});function m(t){f||(r.checked=t,i.hidden=!t,t!==p.isEnabled()&&(t?(e.onEnabledChange?.(!0),p.enable()):(p.disable(),e.onEnabledChange?.(!1))))}let h=()=>m(r.checked),g=()=>p.setSelectedColor(l.value),_=()=>p.resetSelectedColor(),v=()=>p.resetAllColors();return r.addEventListener(`change`,h),l.addEventListener(`input`,g),u.addEventListener(`click`,_),d.addEventListener(`click`,v),{...p,enable:()=>m(!0),disable:()=>m(!1),dispose(){f||(m(!1),p.dispose(),f=!0,r.removeEventListener(`change`,h),l.removeEventListener(`input`,g),u.removeEventListener(`click`,_),d.removeEventListener(`click`,v),t.replaceChildren())}}}function db(e,{intervalMs:t=100,signal:n}={}){let r=null,i=null,a=-1/0,o=e.textContent,s=!1;function c(){i!==null&&clearTimeout(i),i=null}function l(){c(),a=performance.now();let t=pb(r)?r.toLocaleString():`-`;t!==o&&(e.textContent=t,o=t)}function u(e){if(s)return;r=e;let n=t-(performance.now()-a);n<=0?l():i===null&&(i=setTimeout(l,n))}function d(){s||(r=null,l(),a=-1/0)}function f(){s=!0,c(),n?.removeEventListener(`abort`,f)}return n?.aborted?f():n?.addEventListener(`abort`,f,{once:!0}),{update:u,reset:d,dispose:f}}function fb(){let e=!1,t=0;return{recordNativeFrame(n){e&&t!==null&&(t=pb(n)?t+n:null)},measure(n,r){let i=n.autoReset;n.autoReset=!1,n.reset(),t=0,e=!0;try{r();let e=n.render.drawCalls??n.render.calls;return t!==null&&pb(e)?e+t:null}finally{e=!1,n.autoReset=i}}}}function pb(e){return typeof e==`number`&&Number.isSafeInteger(e)&&e>=0}export{_v as $,an as $i,nf as $n,Xa as $r,Dg as $t,ny as A,pi as Ai,om as An,fs as Ar,L_ as At,Uv as B,Zn as Bi,_p as Bn,To as Br,__ as Bt,ly as C,Bi as Ci,Pm as Cn,Ac as Cr,q_ as Ct,py as D,Li as Di,Om as Dn,yc as Dr,z_ as Dt,sy as E,Ii as Ei,Am as En,bc as Er,U_ as Et,Xv as F,yr as Fi,Wp as Fn,Zo as Fr,P_ as Ft,Ev as G,Vn as Gi,Df as Gn,z as Gr,zg as Gt,Nv as H,Hn as Hi,Ff as Hn,zo as Hr,f_ as Ht,Qv as I,sr as Ii,Rp as In,Ko as Ir,O_ as It,xv as J,Cn as Ji,sf as Jn,Ro as Jr,Mg as Jt,Dv as K,In as Ki,af as Kn,Bo as Kr,Rg as Kt,Yv as L,Qn as Li,Jp as Ln,Ho as Lr,k_ as Lt,ay as M,ci as Mi,tm as Mn,ds as Mr,N_ as Mt,ey as N,gr as Ni,qp as Nn,ts as Nr,F_ as Nt,oy as O,ui as Oi,Dm as On,_s as Or,B_ as Ot,Zv as P,Br as Pi,Gp as Pn,rs as Pr,I_ as Pt,bv as Q,rn as Qi,bf as Qn,Za as Qr,wg as Qt,Jv as R,$n as Ri,Lp as Rn,Wo as Rr,M_ as Rt,cy as S,zi as Si,hm as Sn,Vc as Sr,K_ as St,uy as T,Oi as Ti,km as Tn,Pc as Tr,H_ as Tt,Fv as U,Un as Ui,Gf as Un,No as Ur,Bg as Ut,Hv as V,Rn as Vi,Kf as Vn,wo as Vr,p_ as Vt,Tv as W,Wn as Wi,kf as Wn,ko as Wr,Vg as Wt,Sv as X,ln as Xi,gf as Xn,Fo as Xr,Tg as Xt,kv as Y,Sn as Yi,mf as Yn,Lo as Yr,Sg as Yt,Ov as Z,nn as Zi,vf as Zn,Aa as Zr,Cg as Zt,wy as _,Zi as _i,Rm as _n,tu as _r,rv as _t,cb as a,Ue as aa,aa as ai,ag as an,_d as ar,pv as at,vy as b,Gi as bi,qm as bn,Bc as br,nv as bt,ob as c,Be as ca,oa as ci,Ah as cn,Vl as cr,cv as ct,Xy as d,sa as di,Ym as dn,Qu as dr,Q_ as dt,cn as ea,Fa as ei,yg as en,Yd as er,gv as et,My as f,ua as fi,Qm as fn,Zl as fr,Z_ as ft,Ty as g,Xi as gi,uh as gn,nu as gr,iv as gt,Ay as h,ca as hi,hh as hn,Hl as hr,av as ht,lb as i,Et as ia,Ca as ii,cg as in,xd as ir,lv as it,ry as j,di as ji,em as jn,cs as jr,R_ as jt,iy as k,li as ki,rm as kn,ps as kr,V_ as kt,nb as l,Re as la,ra as li,Xm as ln,ou as lr,sv as lt,Ly as m,na as mi,fh as mn,au as mr,ov as mt,fb as n,dt as na,Oa as ni,ug as nn,Cd as nr,yv as nt,ab as o,Ve as oa,ia as oi,sg as on,ad as or,fv as ot,jy as p,da as pi,dh as pn,$l as pr,X_ as pt,Cv as q,jn as qi,of as qn,Vo as qr,Ng as qt,ub as r,ct as ra,xa as ri,lg as rn,Jd as rr,dv as rt,rb as s,He as sa,fa as si,og as sn,Xc as sr,uv as st,db as t,mt as ta,Ia as ti,jg as tn,V as tr,vv as tt,tb as u,Le as ua,la as ui,Zm as un,Uu as ur,tv as ut,Sy as v,Ji as vi,zm as vn,Uc as vr,ev as vt,fy as w,ki as wi,Fm as wn,Ec as wr,W_ as wt,dy as x,Wi as xi,jm as xn,Hc as xr,Y_ as xt,xy as y,Vi as yi,Wm as yn,Gc as yr,$_ as yt,Wv as z,Xn as zi,Tp as zn,Co as zr,T_ as zt};
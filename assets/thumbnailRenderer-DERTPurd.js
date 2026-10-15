import{d as e}from"./heprDocumentData-waBVVYFW.js";import{i as t}from"./nativeTypes-pXzlltQv.js";import{S as n,_ as r,a as i,b as a,c as o,d as s,f as c,g as l,h as u,i as d,l as f,m as p,n as m,o as h,p as g,s as _,u as v,v as y,x as b,y as x}from"./vectorDrawOrder-DUwnXeVL.js";import{B as S,D as C,E as w,F as T,H as E,I as D,L as O,N as k,O as A,P as j,R as M,U as N,V as P,W as F,k as I,n as L,r as R,z as ee}from"./pdfWorkerEntry-C2M39atj.js";import{a as te,i as ne,n as re,o as ie,r as ae,t as oe}from"./rasterTiles-qB5mkfEb.js";function se(e,t){return e.gradientMetaA[t*4]===2?(e.gradientMeshRanges?.[t*2+1]??0)/3:0}function ce(e,t,n){let r=se(e,t);if(!Number.isSafeInteger(n)||n<0||n>=r)throw RangeError(`Mesh triangle index is out of range.`);let i=[],a=[],o=e.gradientMeshRanges[t*2]+n*3,s=t*4,c=e.gradientMetaB,l=e.gradientMetaC,u=c[s]*c[s+3]-c[s+1]*c[s+2];for(let t=0;t<3;t++){let n=e.gradientMeshIndices[o+t],r=e.gradientMeshPositions[n*2]-l[s],d=e.gradientMeshPositions[n*2+1]-l[s+1];i.push({x:(c[s+3]*r-c[s+2]*d)/u,y:(-c[s+1]*r+c[s]*d)/u}),a.push(Array.from(e.gradientMeshColors.subarray(n*4,n*4+4)))}return{points:i,colors:a}}function le(e){let t=new Uint32Array(e.gradientFillPathCount*2),n=0;for(let t=0;t<e.gradientFillPathCount;t++){let r=e.gradientFillPaintMeta[t*4];r>=0&&(n+=se(e,r)*3)}let r=new Float32Array(n*6),i=0;for(let n=0;n<e.gradientFillPathCount;n++){let a=e.gradientFillPaintMeta[n*4],o=a>=0?se(e,a):0;t.set([i/6,o*3],n*2);for(let t=0;t<o;t++){let n=ce(e,a,t);for(let e=0;e<3;e++)r.set([n.points[e].x,n.points[e].y,...n.colors[e]],i),i+=6}}return{vertices:r,ranges:t}}function ue(e,t){return t?new Promise((n,r)=>{let i=()=>{t.removeEventListener(`abort`,i),r(t.reason)};t.addEventListener(`abort`,i,{once:!0}),e.then(e=>{t.removeEventListener(`abort`,i),t.aborted?r(t.reason):n(e)},e=>{t.removeEventListener(`abort`,i),r(t.aborted?t.reason:e)}),t.aborted&&i()}):e}const de=/* @__PURE__ */ new WeakMap;function fe(e,t){if(!e.retainedPages?.length||!e.paintGraph)return;let n=de.get(e);if(!n){let t=/* @__PURE__ */ new Map,r=n=>{for(let i of n)if(i.kind===`group`)r(i.children),i.softMask&&r(i.softMask.children);else if(i.kind===`retained`){let n=e.retainedPages[i.retainedPage],{width:r,height:a}=n.page.pageInfo,o=n.matrix,s=t.get(i.rasterIndex)??{minX:1/0,minY:1/0,maxX:-1/0,maxY:-1/0};for(let e of[0,r])for(let t of[0,a]){let n=o[0]*e+o[2]*t+o[4],r=o[1]*e+o[3]*t+o[5];s.minX=Math.min(s.minX,n),s.minY=Math.min(s.minY,r),s.maxX=Math.max(s.maxX,n),s.maxY=Math.max(s.maxY,r)}t.set(i.rasterIndex,s)}};r(e.paintGraph.roots),de.set(e,n=t)}return n.get(t)}function pe(e){let t=Math.max(0,e.segmentCount|0);return{count:t,segments:[{first:0,count:t,scene:e}]}}function me(e,t,n){for(let r of t.segments)for(let t=0;t<r.count;t++){let i=n[r.first+t]*4,a=t*4;for(let t=1;t<4;t++){let n=r.scene.styles[a+t];if(!Number.isFinite(n)||n!==e.styles[i+t])return!1}}return!0}function he(e){return e.records??pe(e.scene)}function ge(e,t){let n=e.segments,r=0;for(;r+1<n.length&&t>=n[r+1].first;)r++;return n[r]}function*_e(e,t,n,r=4194304){let i=Math.max(0,e.count|0),a=Math.max(1,Math.floor(r/(n*16))),o=e.segments.filter(e=>e.count>0),s=o.map(e=>Math.min(e.count,Math.floor(e.scene[t].length/4))),c=Math.ceil(i/n),l=0;for(let e=0;e<c;){let r=e*n,c=Math.min(r+n,i);for(;l+1<o.length&&r>=o[l+1].first;)l++;let u=o[l];if(u&&c<=u.first+s[l]){let i=1;if(c-r===n){let t=Math.floor((u.first+s[l])/n);i=Math.max(1,Math.min(a,t-e))}let o=(r-u.first)*4,d=i===1?c-r:i*n;yield{y:e,width:i===1?c-r:n,height:i,data:u.scene[t].subarray(o,o+d*4)},e+=i;continue}let d=new Float32Array((c-r)*4),f=!1;for(let e=l;e<o.length&&o[e].first<c;e++){let n=o[e],i=Math.max(r,n.first),a=Math.min(c,n.first+n.count),s=n.scene[t],l=(i-n.first)*4,u=Math.min(s.length,(a-n.first)*4);u<=l||(d.set(s.subarray(l,u),(i-r)*4),f=!0)}f&&(yield{y:e,width:c-r,height:1,data:d}),e++}}const ve=/* @__PURE__ */ new WeakMap,ye=/* @__PURE__ */ new WeakMap,be=/* @__PURE__ */ new Float32Array(1),xe=new Uint32Array(be.buffer);function Se(e,t){let n=Math.fround(e);return(t?n<=e:n>=e)?n:n===0?t?-(2**-149):2**-149:(be[0]=n,xe[0]+=n>0===t?-1:1,be[0])}function Ce(e){let t=e.fillPathMetaA,n=e.fillSegmentsA,r=e.fillSegmentsB,i=e.fillPathCount,a=e.fillSegmentCount,o=t.slice(),s=new Float32Array(i*2),c=new Float32Array(i),l=new Uint8Array(i);for(let e=0;e<i;e++){let i=e*4,u=t[i],d=t[i+1],f=u+d;if(!Number.isSafeInteger(u)||!Number.isSafeInteger(d)||u<0||d<=0||f>a||f*4>n.length||f*4>r.length)continue;let p=1/0,m=1/0,h=-1/0,g=-1/0,_=0,v=0,y=0,b=0,x=!0,S=!0;for(let e=u;e<f;e++){let t=e*4,i=n[t],a=n[t+1],o=r[t],s=r[t+1],c=r[t+2];if(!Number.isFinite(i)||!Number.isFinite(a)||!Number.isFinite(o)||!Number.isFinite(s)||!Number.isFinite(c)){x=!1;break}if((e===u||i!==y||a!==b)&&(e!==u&&(y!==_||b!==v)&&(S=!1),_=i,v=a),y=o,b=s,p=Math.min(p,i,o),m=Math.min(m,a,s),h=Math.max(h,i,o),g=Math.max(g,a,s),c>=1){let e=n[t+2],r=n[t+3];if(!Number.isFinite(e)||!Number.isFinite(r)){x=!1;break}p=Math.min(p,e),m=Math.min(m,r),h=Math.max(h,e),g=Math.max(g,r)}}if(!x)continue;let C=!S||y!==_||b!==v;if(o[i+2]=Se(C?Math.min(p,t[i+2]):p,!0),o[i+3]=Se(C?Math.min(m,t[i+3]):m,!0),s[e*2]=Se(h,!1),s[e*2+1]=Se(g,!1),l[e]=C?5:1,C)continue;let w=0,T=0;for(let e=u;e<f;e++){let t=e*4,i=n[t]-p,a=n[t+1]-m,o=r[t]-p,s=r[t+1]-m,c=(i*s-a*o)/2;if(r[t+2]>=1){let e=n[t+2]-p,r=n[t+3]-m;c=(i*r-a*e)/3+(e*s-r*o)/3+(i*s-a*o)/6}let l=w+c;T+=Math.abs(w)>=Math.abs(c)?w-l+c:c-l+w,w=l}w+=T;let E=Math.fround(w);!Number.isFinite(E)||E===0&&w!==0||(c[e]=E,l[e]=3)}return{segmentsA:n,segmentsB:r,pathCount:i,segmentCount:a,pathMetaA:o,upperBounds:s,areas:c,flags:l}}function we(e){let t=e.fillPathMetaA,n=e.fillPathMetaB,r=e.fillPathMetaC,i=ve.get(t);(!i||i.segmentsA!==e.fillSegmentsA||i.segmentsB!==e.fillSegmentsB||i.pathCount!==e.fillPathCount||i.segmentCount!==e.fillSegmentCount)&&(i=Ce(e),ve.set(t,i));let a=ye.get(t);if(a?.sourceB===n&&a.sourceC===r&&a.geometry===i)return a.result;let o=n.slice(),s=r.slice();for(let t=0;t<e.fillPathCount;t++){let e=t*4;if(i.flags[t]&1){let r=!!(i.flags[t]&4);o[e]=r?Math.max(n[e],i.upperBounds[t*2]):i.upperBounds[t*2],o[e+1]=r?Math.max(n[e+1],i.upperBounds[t*2+1]):i.upperBounds[t*2+1]}let a=r[e],c=i.flags[t]===3&&(a===0||a===1);s[e]=c?a:-(a>=.5?2:1),s[e+1]=c?i.areas[t]:0}let c={pathMetaA:i.pathMetaA,pathMetaB:o,pathMetaC:s};return ye.set(t,{sourceB:n,sourceC:r,geometry:i,result:c}),c}var Te=class{selected=null;selectedFlags=null;bounds;visible=[];scene;clipBounds;paddedBounds=null;padding=NaN;allPaddedBounds=null;nonemptyRuns=[];nonemptyFlags=null;allPaddedRuns=[];guardBounds=null;guardRuns=[];guardFlags=null;constructor(e,t){this.scene=e;let n=e.drawRuns??[],r=e.fillPathCount>0&&e.fillSegmentsA&&e.fillSegmentsB&&e.fillPathMetaC?we(e):null,i=r?.pathMetaA??e.fillPathMetaA,a=r?.pathMetaB??e.fillPathMetaB;this.bounds=new Float64Array(n.length*4);let o=(e.clipPaths??[]).map(e=>{let t=[1/0,1/0,-1/0,-1/0];for(let n=0;n<e.edges.length;n+=2)t[0]=Math.min(t[0],e.edges[n]),t[1]=Math.min(t[1],e.edges[n+1]),t[2]=Math.max(t[2],e.edges[n]),t[3]=Math.max(t[3],e.edges[n+1]);return t});if(this.clipBounds=o,e.clipPaths?.forEach((e,t)=>{e.parent>=0&&Oe(o[t],o[e.parent])}),n.forEach((t,n)=>{let r=[1/0,1/0,-1/0,-1/0],o=(e,t,n=0)=>{r[0]=Math.min(r[0],e-n),r[1]=Math.min(r[1],t-n),r[2]=Math.max(r[2],e+n),r[3]=Math.max(r[3],t+n)};for(let n=t.first;n<t.first+t.count;n++){let s=n*4;if(t.kind===`stroke`){let t=Math.SQRT2*Math.max(0,e.styles[s]);o(e.endpoints[s],e.endpoints[s+1],t),o(e.endpoints[s+2],e.endpoints[s+3],t),o(e.primitiveMeta[s],e.primitiveMeta[s+1],t)}else if(t.kind===`fill`)o(i[s+2],i[s+3]),o(a[s],a[s+1]);else if(t.kind===`text`){let t=Math.round(e.textInstanceB[s+2])*4;for(let n of[e.textGlyphMetaA[t+2],e.textGlyphMetaB[t]])for(let r of[e.textGlyphMetaA[t+3],e.textGlyphMetaB[t+1]])o(e.textInstanceA[s]*n+e.textInstanceA[s+2]*r+e.textInstanceB[s],e.textInstanceA[s+1]*n+e.textInstanceA[s+3]*r+e.textInstanceB[s+1])}else if(t.kind===`raster`){let t=fe(e,n);if(t){o(t.minX,t.minY),o(t.maxX,t.maxY);continue}let r=e.rasterLayers[n].repeat;if(r){let e=C(r);o(e.minX,e.minY),o(e.maxX,e.maxY);continue}let i=e.rasterLayers[n].matrix;for(let e of[0,1])for(let t of[0,1])o(i[0]*e+i[2]*t+i[4],i[1]*e+i[3]*t+i[5])}else{r.splice(0,4,-1/0,-1/0,1/0,1/0);break}}this.bounds.set(r,n*4)}),t){n.forEach((e,t)=>{e.kind===`stroke`&&this.bounds.set([1/0,1/0,-1/0,-1/0],t*4)});for(let e of he(t).segments)for(let n=0;n<e.count;n++)Ee(this.bounds,t.sourceRuns[e.first+n]*4,e.scene,n)}}includeTextLod(e){let t=(this.scene.drawRuns??[]).flatMap((e,t)=>e.kind===`text`?[{run:e,index:t}]:[]).sort((e,t)=>e.run.first-t.run.first),n=0;for(let r of e.runs){if(r.coarseIndex<0)continue;for(;n<t.length&&t[n].run.first+t[n].run.count<=r.exactStart;)n++;if(n===t.length)break;let e=t[n].index*4,i=r.bounds;this.bounds[e]=Math.min(this.bounds[e],i.minX),this.bounds[e+1]=Math.min(this.bounds[e+1],i.minY),this.bounds[e+2]=Math.max(this.bounds[e+2],i.maxX),this.bounds[e+3]=Math.max(this.bounds[e+3],i.maxY)}this.padding=NaN,this.guardBounds=null}getUnclippedBounds(e,t,n){let r=e*4;n[0]=this.bounds[r]-t,n[1]=this.bounds[r+1]-t,n[2]=this.bounds[r+2]+t,n[3]=this.bounds[r+3]+t}getBounds(e,t,n){this.getUnclippedBounds(e,t,n);let r=this.scene.drawRuns[e].clipIndex;r!==void 0&&Oe(n,this.clipBounds[r])}select(e,t,n=0){let r=this.scene.drawRuns??[];if(this.selected=null,!e||![e.minX,e.minY,e.maxX,e.maxY].every(Number.isFinite))return this.guardBounds=null,r;let i=Math.max(n,.001,t*4);if(!Number.isFinite(i))return this.guardBounds=null,r;let a=2**Math.ceil(Math.log2(i));if(!this.paddedBounds||this.padding!==a){this.paddedBounds??=new Float64Array(this.bounds.length),this.padding=a,this.guardBounds=null;let e=[0,0,0,0],t={minX:1/0,minY:1/0,maxX:-1/0,maxY:-1/0};this.nonemptyRuns.length=0,this.nonemptyFlags??=new Uint8Array(r.length),this.nonemptyFlags.fill(0);for(let n=0;n<r.length;n++)this.getBounds(n,a,e),this.paddedBounds.set(e,n*4),!(e[0]>e[2]||e[1]>e[3])&&(this.nonemptyRuns.push(r[n]),this.nonemptyFlags[n]=1,t.minX=Math.min(t.minX,e[0]),t.minY=Math.min(t.minY,e[1]),t.maxX=Math.max(t.maxX,e[2]),t.maxY=Math.max(t.maxY,e[3]));this.allPaddedBounds=t,this.allPaddedRuns=this.nonemptyRuns.length===r.length?r:this.nonemptyRuns}let o=r.length>=1024&&t>0?256*t:0;if(o>0&&this.guardBounds&&e.minX>=this.guardBounds.minX&&e.minY>=this.guardBounds.minY&&e.maxX<=this.guardBounds.maxX&&e.maxY<=this.guardBounds.maxY&&this.guardBounds.maxX-this.guardBounds.minX<=e.maxX-e.minX+o*4&&this.guardBounds.maxY-this.guardBounds.minY<=e.maxY-e.minY+o*4)return this.selected=this.guardFlags,this.guardRuns;let s=o>0?{minX:e.minX-o,minY:e.minY-o,maxX:e.maxX+o,maxY:e.maxY+o}:null;s&&[s.minX,s.minY,s.maxX,s.maxY].every(Number.isFinite)?e=s:(s=null,this.guardBounds=null);let c=this.allPaddedBounds;if(c&&e.minX<=c.minX&&e.minY<=c.minY&&e.maxX>=c.maxX&&e.maxY>=c.maxY)return this.rememberSelection(s,this.allPaddedRuns,this.allPaddedRuns===r?null:this.nonemptyFlags);let l=0,u=this.paddedBounds;(!this.selectedFlags||this.selectedFlags.length!==r.length)&&(this.selectedFlags=new Uint8Array(r.length));let d=this.selectedFlags;d.fill(0);for(let t=0;t<r.length;t++){let n=t*4,i=u[n],a=u[n+1],o=u[n+2],s=u[n+3];i>o||a>s||o<e.minX||s<e.minY||i>e.maxX||a>e.maxY||(d[t]=1,this.visible[l++]=r[t])}return this.visible.length=l,this.rememberSelection(s,l===r.length?r:this.visible,l===r.length?null:d)}rememberSelection(e,t,n){return this.guardBounds=e,this.guardRuns=t,this.guardFlags=this.selected=n,t}};function Ee(e,t,n,r){let i=r*4,a=Math.SQRT2*Math.max(0,n.styles[i]),o=!!(Math.floor(n.primitiveMeta[i+3]/2+1e-6)&4),s=o?n.primitiveBounds[i]:Math.min(n.endpoints[i],n.endpoints[i+2],n.primitiveMeta[i])-a,c=o?n.primitiveBounds[i+1]:Math.min(n.endpoints[i+1],n.endpoints[i+3],n.primitiveMeta[i+1])-a,l=o?n.primitiveBounds[i+2]:Math.max(n.endpoints[i],n.endpoints[i+2],n.primitiveMeta[i])+a,u=o?n.primitiveBounds[i+3]:Math.max(n.endpoints[i+1],n.endpoints[i+3],n.primitiveMeta[i+1])+a;e[t]=Math.min(e[t],s),e[t+1]=Math.min(e[t+1],c),e[t+2]=Math.max(e[t+2],l),e[t+3]=Math.max(e[t+3],u)}function De(e,t,n,r,i){let a=e/(2*Math.max(i,1e-6)),o=t/(2*Math.max(i,1e-6));return{minX:n-a,minY:r-o,maxX:n+a,maxY:r+o}}function Oe(e,t){e[0]=Math.max(e[0],t[0]),e[1]=Math.max(e[1],t[1]),e[2]=Math.min(e[2],t[2]),e[3]=Math.min(e[3],t[3])}const ke=[`Normal`,`Multiply`,`Screen`,`Overlay`,`Darken`,`Lighten`,`ColorDodge`,`ColorBurn`,`HardLight`,`SoftLight`,`Difference`,`Exclusion`,`Hue`,`Saturation`,`Color`,`Luminosity`];function Ae(e,t){let n=[],r=0,i=(a,o)=>{for(let s of a)if(t(s.optionalContent)){if(s.kind===`draw`){let r=e.drawRuns?.[s.runIndex];if(!r)throw RangeError(`PDF paint graph references an unknown draw run.`);t(r.optionalContent)&&n.push({kind:`draw`,runIndex:s.runIndex})}else if(s.kind===`retained`)n.push({kind:`retained`,node:s});else{let e=r++;n.push({kind:`begin-group`,id:e,node:s}),s.softMask&&(n.push({kind:`begin-mask`,id:e,mask:s.softMask}),i(s.softMask.children,o+1),n.push({kind:`end-mask`,id:e})),i(s.children,o+1),n.push({kind:`end-group`,id:e})}}};return e.paintGraph?i(e.paintGraph.roots,0):e.drawRuns?.forEach((e,r)=>{t(e.optionalContent)&&n.push({kind:`draw`,runIndex:r})}),n}const je=/* @__PURE__ */ new WeakMap,Me=/* @__PURE__ */ new WeakMap,Ne=/* @__PURE__ */ new WeakMap;function Pe(e,t){let n=e.drawRuns?.[t];if(!n||n.blendMode||n.count<=0||n.kind!==`stroke`&&n.kind!==`fill`&&n.kind!==`text`)return null;let r=null;for(let t=n.first;t<n.first+n.count;t++){let i=t*4,a,o,s;if(n.kind===`stroke`?(a=e.styles?.[i+1],o=e.styles?.[i+2],s=e.styles?.[i+3]):n.kind===`fill`?(a=e.fillPathMetaB?.[i+2],o=e.fillPathMetaB?.[i+3],s=e.fillPathMetaC?.[i+2]):(a=e.textInstanceC?.[i],o=e.textInstanceC?.[i+1],s=e.textInstanceC?.[i+2]),!Number.isFinite(a)||!Number.isFinite(o)||!Number.isFinite(s))return null;if(n.kind===`text`&&(a=Math.fround(Math.round(Math.max(0,Math.min(1,a))*255)/255),o=Math.fround(Math.round(Math.max(0,Math.min(1,o))*255)/255),s=Math.fround(Math.round(Math.max(0,Math.min(1,s))*255)/255)),r){if(a!==r[0]||o!==r[1]||s!==r[2])return null}else r=[a,o,s]}return r}function Fe(e,t,n){for(let r of t)if(r.kind===`group`){if(r.knockout||r.blendMode!==`Normal`||!Fe(e,r.children,n+1))return!1}else if(r.kind===`draw`&&e.drawRuns?.[r.runIndex]?.blendMode)return!1;return!0}function Ie(e,t=!0,n=!0){if(!e.paintGraph)return[];let r=t?n?je:Ne:Me,i=r.get(e);if(i)return i;let a=/* @__PURE__ */ new Map,o=t=>(a.has(t)||a.set(t,Pe(e,t)),a.get(t)),s=(r,i,a,c)=>{let l=[],u=null,d=n=>{let r=n.kind===`group`&&n.children.length===1?n.children[0]:null,i=r?.kind===`draw`?e.drawRuns?.[r.runIndex]:null,a=t&&!c&&n.kind===`group`&&n.alpha===1&&!n.softMask&&!n.knockout&&n.blendMode===`Darken`&&r?.kind===`draw`?o(r.runIndex):null;if(a&&i&&n.kind===`group`){let e=i.kind===`text`?`text`:`vector`;if(u&&u.kind===e&&u.group.optionalContent===n.optionalContent&&u.group.alphaIsShape===n.alphaIsShape&&a.every((e,t)=>e===u.color[t])){u.copied||(u.group={...u.group,children:[...u.group.children]},l[l.length-1]=u.group,u.copied=!0),u.group.children.push(r);return}u={group:n,kind:e,color:a,copied:!1}}else u=null;l.push(n)};for(let l of r){if(l.kind!==`group`){d(l);continue}let r=!l.knockout&&Fe(e,l.children,0),u=s(l.children,i+1,l.knockout,c||l.knockout),f=t&&n&&!c&&l.blendMode===`Darken`&&u.length===1&&u[0].kind===`draw`&&o(u[0].runIndex)?.every(e=>e===0);if(!a&&l.alpha===1&&!l.softMask&&!l.knockout&&(l.blendMode===`Normal`||f)&&(!l.isolated||r)&&(l.optionalContent===void 0||u.every(e=>e.optionalContent===void 0||e.optionalContent===l.optionalContent))){for(let e of u)d(l.optionalContent!==void 0&&e.optionalContent===void 0?{...e,optionalContent:l.optionalContent}:e);continue}let p=l.softMask?{...l.softMask,children:s(l.softMask.children,i+1,!1,!1)}:void 0;d({...l,children:u,softMask:p,isolated:l.isolated||r})}return l},c=s(e.paintGraph.roots,0,!1,!1);return r.set(e,c),c}const Le=/* @__PURE__ */ new WeakMap,Re=/* @__PURE__ */ new WeakMap,ze=/* @__PURE__ */ new WeakMap;function Be(e,t=!0,n=!0){if(!e.paintGraph||!e.drawRuns)return null;let r=t?n?Le:ze:Re,i=r.get(e);if(i)return i;let a=e.drawRuns,o=new Uint32Array(a.length),s=/* @__PURE__ */ new Map;a.forEach((e,t)=>{e.kind===`raster`&&e.count===1&&s.set(e.first,t)});let c=0,l=(e,t,n=!1)=>{c++;for(let r of e){if(r.kind===`group`){c++,r.softMask&&l(r.softMask.children,t+1),l(r.children,t+1,r.knockout),c++;continue}let e=r.kind===`draw`?r.runIndex:s.get(r.rasterIndex);e===void 0||e>=a.length||(n||a[e].blendMode?(c++,o[e]=c,c++):o[e]=c)}c++};return l(Ie(e,t,n),0),r.set(e,o),o}const Ve=/* @__PURE__ */ new WeakMap,He=/* @__PURE__ */ new WeakMap,Ue=/* @__PURE__ */ new WeakMap,We={minX:-1/0,minY:-1/0,maxX:1/0,maxY:1/0};function Ge(e,t=!0,n=!0){let r=t?n?Ve:Ue:He,i=r.get(e);if(i)return i;let a={nodes:/* @__PURE__ */ new Map,runs:null},o=e.drawRuns;if(!o||!e.paintGraph)return r.set(e,a),a;let s;try{s=new Te(e)}catch{return r.set(e,a),a}let c=[0,0,0,0],l=new Float64Array(o.length*4),u=/* @__PURE__ */ new Map;o.forEach((e,t)=>{e.kind===`raster`&&e.count===1&&u.set(e.first,t)});let d=(e,t)=>{let n={minX:1/0,minY:1/0,maxX:-1/0,maxY:-1/0},r=e=>{n.minX=Math.min(n.minX,e.minX),n.minY=Math.min(n.minY,e.minY),n.maxX=Math.max(n.maxX,e.maxX),n.maxY=Math.max(n.maxY,e.maxY)};for(let n of e){if(n.kind===`group`){n.softMask&&d(n.softMask.children,t+1),r(d(n.children,t+1));continue}let e=n.kind===`draw`?n.runIndex:u.get(n.rasterIndex);if(!(e===void 0||e>=o.length)){try{s.getBounds(e,0,c)}catch{r(We);continue}if(c.some(e=>Number.isNaN(e))){r(We);continue}l.set(c,e*4),r({minX:c[0],minY:c[1],maxX:c[2],maxY:c[3]})}}return a.nodes.set(e,n),n};return l.fill(1/0),d(Ie(e,t,n),0),a.runs=l,r.set(e,a),a}const Ke=/* @__PURE__ */ new WeakMap;function qe(e){let t=Ke.get(e);if(t)return t;t={scopes:/* @__PURE__ */ new Map,ordered:[]};let n=/* @__PURE__ */ new Map;for(let t of e.drawRuns??[])t.kind===`raster`&&t.count===1&&n.set(t.first,t);let r=(i,a,o)=>{for(let s of i){let i={parent:a,condition:s.optionalContent,maskOnly:o,...s.kind===`group`?{group:s}:{}};if(s.kind===`group`)s.softMask&&r(s.softMask.children,i,!0),r(s.children,i,o);else{let r=s.kind===`draw`?e.drawRuns?.[s.runIndex]:n.get(s.rasterIndex);r&&(t.scopes.set(r,i),t.ordered.push(r))}}};return r(e.paintGraph?.roots??[],null,!1),Ke.set(e,t),t}function Je(e,t,n){if(!t||!n(t.optionalContent))return!1;if(!e.paintGraph)return!0;let r=qe(e).scopes.get(t);if(!r||r.maskOnly)return!1;for(;r;r=r.parent??void 0)if(!n(r.condition)||r.group?.alpha===0)return!1;return!0}function Ye(e,t,n=!0){let r=/* @__PURE__ */ new Set;t?.optionalContent!==void 0&&r.add(t.optionalContent);let i=t=>{for(let n of t)if(n.optionalContent!==void 0&&r.add(n.optionalContent),n.kind===`draw`){let t=e.drawRuns?.[n.runIndex]?.optionalContent;t!==void 0&&r.add(t)}else n.kind===`group`&&(i(n.children),n.softMask&&i(n.softMask.children))};for(let a=t&&e.paintGraph?qe(e).scopes.get(t):void 0;a;a=a.parent??void 0)a.condition!==void 0&&r.add(a.condition),n&&a.group?.softMask&&i(a.group.softMask.children);return[...r]}const Xe=/* @__PURE__ */ new WeakMap;function Ze(){let e=globalThis;return e.HEPR_DEBUG_DISABLE_COMPOSITING===!0||typeof e.location?.search==`string`&&new URLSearchParams(e.location.search).has(`noComposite`)}function Qe(e){if(!e.paintGraph||Ze())return!1;let t=Xe.get(e);if(t!==void 0)return t;let n=e.drawRuns??[],r=0,i=e=>{for(let t of e)if(t.kind===`group`){if(t.alpha!==1||t.knockout||t.softMask||t.blendMode!==`Normal`||!i(t.children))return!1}else{let e=n[r];if(!e||(t.kind===`draw`?t.runIndex!==r:e.kind!==`raster`||e.first!==t.rasterIndex||e.count!==1)||e.blendMode)return!1;r++}return!0},a=!i(e.paintGraph.roots)||r!==n.length;return Xe.set(e,a),a}var $e=class{requiresCompositing;orderedRuns;snapshot=null;visibilityRevision=0;eligible=/* @__PURE__ */ new Set;visibleRuns=[];selected=[];allVisible=!0;scene;defaults;constructor(e){this.scene=e,this.orderedRuns=e.drawRuns??[],this.requiresCompositing=Qe(e),this.defaults=L(e),this.setVisibility(this.defaults)}get revision(){return this.visibilityRevision}setVisibility(e){if(e??=this.defaults,this.snapshot===e)return;this.snapshot=e,this.visibilityRevision++,this.eligible.clear();let t=t=>t===void 0||e.conditions[t]===1,n=[];for(let r of this.orderedRuns){let i=r.pdfRepresentation;i&&i.detail!==(e.rasterPages?.has(i.pageIndex)??!1)||Je(this.scene,r,t)&&(this.eligible.add(r),n.push(r))}this.allVisible=n.length===this.orderedRuns.length,this.visibleRuns=this.allVisible?this.orderedRuns:n}isRunVisible(e){return this.eligible.has(e)}select(e){if(this.allVisible)return e;if(e===this.orderedRuns)return this.visibleRuns;this.selected.length=0;for(let t of e)this.eligible.has(t)&&this.selected.push(t);return this.selected}};const z=/* @__PURE__ */ new WeakMap,et=/* @__PURE__ */ new WeakMap,tt=/* @__PURE__ */ new WeakMap,nt=/* @__PURE__ */ new WeakMap,rt=/* @__PURE__ */ new WeakMap;function it(e){let t=rt.get(e);if(t!==void 0)return t;let n=!e.drawRuns?.some(e=>e.blendMode);if(n&&Qe(e)){let t=e=>e.every(e=>e.kind!==`group`||e.alpha===1&&!e.knockout&&!e.softMask&&(e.blendMode===`Normal`||e.blendMode===`Darken`&&e.isolated)&&t(e.children));n=!!(e.paintGraph&&e.drawRuns&&at(e)&&t(Ie(e)))}return rt.set(e,n),n}function at(e){let t=nt.get(e);if(t!==void 0)return t;let n=e.drawRuns??[],r=/* @__PURE__ */ new Map;n.forEach((e,t)=>{e.kind===`raster`&&e.count===1&&r.set(e.first,t)});let i=0,a=e=>{for(let t of e)if(t.kind===`group`){if(t.softMask&&!a(t.softMask.children)||!a(t.children))return!1}else if((t.kind===`draw`?t.runIndex:r.get(t.rasterIndex))!==i++)return!1;return!0},o=a(Ie(e))&&i===n.length;return nt.set(e,o),o}function ot(e){if(!e.drawRuns)return z.get(e);let t=z.get(e);if(!t){t=new Uint32Array(e.segmentCount);for(let e=0;e<t.length;e++)t[e]=e;z.set(e,t)}return t}function st(e,t){t&&z.set(e,t)}function ct(e){return z.get(e)}function lt(e){return z.has(e)||e.drawRuns!==void 0}function ut(e,t){let n=z.get(e);return n?n[t]:e.drawRuns?t:void 0}function dt(e){et.delete(e),tt.delete(e)}function ft(e,t=!0){if(!e.drawRuns)return;let n=t?et:tt,r=n.get(e);if(r)return r;r=new Uint32Array(e.segmentCount);let i=t&&e.paintGraph&&at(e)?Be(e,!0,!1):null,a,o=-1,s;for(let t=0;t<e.drawRuns.length;t++){let n=e.drawRuns[t];if(n.kind!==`stroke`){a=void 0,s=void 0;continue}let c=n.first,l;i&&a&&o===t-1&&a.first+a.count===n.first&&i[o]===i[t]&&!n.blendMode&&!a.blendMode&&a.clipIndex===n.clipIndex&&a.optionalContent===n.optionalContent&&a.pdfRepresentation?.pageIndex===n.pdfRepresentation?.pageIndex&&a.pdfRepresentation?.detail===n.pdfRepresentation?.detail&&pt(e,n.first-1,n.first)&&(s??=Ye(e,a,!1).sort((e,t)=>e-t),l=Ye(e,n,!1).sort((e,t)=>e-t),s.length===l.length&&s.every((e,t)=>e===l[t])&&(c=r[n.first-1]));for(let t=n.first;t<n.first+n.count;t++){let i=t*4,a=e.primitiveMeta[i+3],o=a-Math.floor(a/2+1e-6)*2;t>n.first&&(o<.999||a!==e.primitiveMeta[i-1]||e.styles[i+1]!==e.styles[i-3]||e.styles[i+2]!==e.styles[i-2]||e.styles[i+3]!==e.styles[i-1])&&(c=t),r[t]=c}a=n,o=t,s=l}return n.set(e,r),r}function pt(e,t,n){let r=t*4,i=n*4,a=e.primitiveMeta[i+3];return a-Math.floor(a/2+1e-6)*2==1&&a===e.primitiveMeta[r+3]&&e.styles[i+1]===e.styles[r+1]&&e.styles[i+2]===e.styles[r+2]&&e.styles[i+3]===e.styles[r+3]}function mt(e){if(e===`bc7`)return{blockWidth:4,blockHeight:4,bytesPerBlock:16,webGpuFormat:`bc7-rgba-unorm`};if(e===`astc-4x4`)return{blockWidth:4,blockHeight:4,bytesPerBlock:16,webGpuFormat:`astc-4x4-unorm`};throw RangeError(`Unsupported raster compression format: ${String(e)}.`)}function ht(e){return e.bc7?`bc7`:e.astc4x4?`astc-4x4`:null}function gt(e,t,n,r={}){xt(e,t);let{blockWidth:i,blockHeight:a,bytesPerBlock:o}=mt(n),s=r.padBase===!1?e:Math.ceil(e/i)*i,c=r.padBase===!1?t:Math.ceil(t/a)*a;xt(s,c);let l=Math.floor(Math.log2(Math.max(s,c)))+1,u=r.mipmaps===!1?1:r.mipLevelCount??l;if(!Number.isInteger(u)||u<1||u>l)throw RangeError(`Invalid compressed mip level count.`);let d=[],f=0;for(let e=0;e<u;e++){let e=Math.ceil(s/i),t=Math.ceil(c/a),n=e*t*o;d.push({width:s,height:c,blocksX:e,blocksY:t,byteOffset:f,byteLength:n}),f+=n,s=Math.max(1,Math.floor(s/2)),c=Math.max(1,Math.floor(c/2))}return d}function _t(e,t,n,r=!0,i=!0,a){return gt(e,t,n,{mipmaps:r,padBase:i,mipLevelCount:a}).reduce((e,t)=>e+t.byteLength,0)}function*vt(e,n,r,i){if(t(i),xt(n,r),!(e instanceof Uint8Array)||e.length<n*r*4)throw RangeError(`Insufficient compression source pixels.`);let a=Math.ceil(n/4)*4,o=Math.ceil(r/4)*4;xt(a,o);let s=e;if(a!==n||o!==r){s=new Uint8Array(a*o*4);for(let c=0;c<o;c++){c&63||t(i);let o=Math.min(r-1,c),l=e.subarray(o*n*4,(o+1)*n*4);s.set(l,c*a*4);let u=l.subarray((n-1)*4);for(let e=n;e<a;e++)s.set(u,(c*a+e)*4)}}for(yield{width:a,height:o,data:s};a>1||o>1;){t(i);let e=Math.max(1,Math.floor(a/2)),n=Math.max(1,Math.floor(o/2)),r=new Uint8Array(e*n*4);for(let c=0;c<n;c++){c&63||t(i);let n=Math.min(o-1,c*2),l=Math.min(o-1,n+1);for(let t=0;t<e;t++){let i=Math.min(a-1,t*2),o=Math.min(a-1,i+1);for(let u=0;u<4;u++)r[(c*e+t)*4+u]=s[(n*a+i)*4+u]+s[(n*a+o)*4+u]+s[(l*a+i)*4+u]+s[(l*a+o)*4+u]+2>>2}}s=r,a=e,o=n,yield{width:a,height:o,data:s}}}function yt(e){let t=(e,t=!1,n=0,r=0,i=0)=>({eligible:e===`smooth-color`||e===`scan`,reason:e,opaque:t,sampledPixels:n,edgeFraction:r,maxGradient:i});if(e.monochrome)return t(`monochrome`);if(e.imageMask||e.stencilMask)return t(`mask`);if(e.exactPixels)return t(`exact-pixels`);if(e.containsText)return t(`text`);let{width:n,height:r}=e;if(!bt(n,r))return t(`invalid-pixels`);if(n*r<4096)return t(`small-image`);if(Math.min(n,r)<16)return t(`thin-image`);let i=e.data;if(!(i instanceof Uint8Array)||i.length<n*r*4)return t(`invalid-pixels`);let a=-1,o=-1,s=!1;for(let e=0;e<n*r*4;e+=4){if(i[e+3]!==255)return t(`alpha`);if(!s){let t=i[e]|i[e+1]<<8|i[e+2]<<16;a<0?a=t:t!==a&&t!==o&&(o<0?o=t:s=!0)}}if(!s)return t(`binary`,!0);let c=Math.ceil(n/4),l=Math.ceil(r/4),u=Math.min(64,c),d=Math.min(l,Math.floor(4096/u)),f=0,p=0,m=0,h=0,g=(e,t)=>{let n=Math.max(Math.abs(i[e]-i[t]),Math.abs(i[e+1]-i[t+1]),Math.abs(i[e+2]-i[t+2]));p++,n>=24&&m++,h=Math.max(h,n)};for(let e=0;e<d;e++){let t=(d===1?0:Math.floor(e*(l-1)/(d-1)))*4;for(let e=0;e<u;e++){let i=(u===1?0:Math.floor(e*(c-1)/(u-1)))*4;for(let e=t;e<Math.min(r,t+4);e++)for(let t=i;t<Math.min(n,i+4);t++){let i=(e*n+t)*4;f++,t+1<n&&g(i,i+4),e+1<r&&g(i,i+n*4)}}}let _=p?m/p:0;return t(h>=64||_>.025?e.compressionHint===`scan`?`scan`:`detailed-content`:`smooth-color`,!0,f,_,h)}function bt(e,t){return Number.isSafeInteger(e)&&e>0&&Number.isSafeInteger(t)&&t>0&&Number.isSafeInteger(e*t*4)}function xt(e,t){if(!bt(e,t))throw RangeError(`Invalid raster compression dimensions.`)}const St=1048576,Ct=/* @__PURE__ */ new WeakMap;function wt(e,t,n){let r=e.monochrome?.data;if(!r||typeof r!=`object`||!Number.isSafeInteger(n)||n<=0)return;let i=Ct.get(r)??/* @__PURE__ */ new Map,a=Tt(e,t);!i.has(a)&&i.size>=8&&i.delete(i.keys().next().value),i.set(a,n),Ct.set(r,i)}function Tt(e,t){return`${e.width}:${e.height}:${t.width}:${t.height}:`+t.tiles.map(e=>`${e.x},${e.y},${e.width},${e.height}`).join(`;`)}function Et(e,t,n){let r=At(e,t,n),i=e.monochrome?.data;if(!i||typeof i!=`object`||!e.reducedMonochrome&&oe(e,t))return r;let a=Ct.get(i)?.get(Tt(e,t));return a===void 0?r:Math.min(r,a)}function Dt(){let e=null;try{let t=globalThis.navigator?.deviceMemory;typeof t==`number`&&Number.isFinite(t)&&t>0&&(e=t)}catch{}let t=e===null?67108864:Math.floor(Math.max(16777216,Math.min(268435456,e*1073741824/32)));return{bytes:t,peakBytes:t*2,deviceMemoryGiB:e,source:e===null?`fallback`:`device-memory`}}function Ot(e,t,n,r,i=!1){if(Nt(e,t),!n&&r)return _t(e,t,r);if(n||i){let r=P(e,t);return(n?Math.ceil(e/8)*t:e*t)+r.width*r.height}let a=e,o=t,s=a*o*4;for(;a>1||o>1;)a=Math.max(1,Math.floor(a/2)),o=Math.max(1,Math.floor(o/2)),s+=a*o*4;return s}function kt(e,t,n,r=!1){return e.tiles.reduce((e,i)=>e+Ot(i.width,i.height,t,n,r),0)}function At(e,t,n){let r=!!e.monochrome&&!oe(e,t);return kt(t,r,n,!!e.monochrome&&!!e.reducedMonochrome&&!r)}function jt(e){let t=/* @__PURE__ */ new Map;return(n,r)=>{let i=t.get(n);i||t.set(n,i=/* @__PURE__ */ new Map);let a=i.get(r);return a||(a=re(n,r,e),i.set(r,a)),a}}function Mt(e,t,n,r){let i=Dt(),a=n===void 0||!Number.isFinite(n)?i.bytes:Math.max(0,Math.min(i.bytes,Math.floor(n))),o=jt(t),s=e.map(e=>{Nt(e.width,e.height);let t=e.displayWidth===void 0?e.width:Math.max(1,Math.min(e.width,Math.floor(e.displayWidth))),n=e.displayHeight===void 0?e.height:Math.max(1,Math.min(e.height,Math.floor(e.displayHeight)));return Nt(t,n),o(t,n)}),c=e.map((e,t)=>!!e.monochrome&&e.displayWidth===void 0&&!oe(e,s[t])),l=e.map(e=>Number.isFinite(e.allocationCopies)&&e.allocationCopies>=1?Math.ceil(e.allocationCopies):1),u=s.map((t,n)=>Et(e[n],t)*l[n]),d=u.reduce((e,t)=>e+t,0),f=u.reduce((e,t,n)=>e+(c[n]?t:0),0),p=(e,t,n,r)=>({plans:e,compressionFormats:r,budget:i,availableBytes:a,unscaledBytes:d,estimatedBytes:t,protectedBytes:f,resolutionScale:n,overBudget:t>a});if(d<=a&&!e.some(e=>e.preferCompression)||c.every(Boolean))return p(s,d,1,e.map(()=>null));let m=t=>{let n=t.map((t,n)=>!r||c[n]||e[n].monochrome||!e[n].compressionEligible||d<=a&&!e[n].preferCompression?null:kt(t,!1,r)<kt(t,!1)?r:null);return{plans:t,bytes:t.reduce((t,r,i)=>t+(c[i]?u[i]:Et(e[i],r,n[i])*l[i]),0),compressionFormats:n}},h=m(s);if(h.bytes<=a)return p(s,h.bytes,1,h.compressionFormats);let g=e=>{let n=jt(t),r=s.map((t,r)=>c[r]?t:n(Math.max(1,Math.floor(t.width*e)),Math.max(1,Math.floor(t.height*e))));return m(r)},_=0,v=1,y=g(0);if(y.bytes>a)return p(y.plans,y.bytes,0,y.compressionFormats);for(let e=0;e<32;e++){let e=(_+v)/2,t=g(e);t.bytes<=a?(_=e,y=t):v=e}return p(y.plans,y.bytes,_,y.compressionFormats)}function Nt(e,t){if(!Number.isSafeInteger(e)||e<1||!Number.isSafeInteger(t)||t<1||!Number.isSafeInteger(e*t*4))throw RangeError(`Raster memory estimates require positive integer dimensions with a safe byte count.`)}const Pt=/* @__PURE__ */ new WeakMap,Ft=/* @__PURE__ */ new Set;function It(e,t){let n=e.compressionFormats.filter(Boolean).length;if(e.resolutionScale>=1&&!e.overBudget&&!n)return;let r=`${e.budget.bytes}:${e.availableBytes}:${e.unscaledBytes}:${e.estimatedBytes}:${e.protectedBytes}:${e.compressionFormats.join(`,`)}`;if(t?Pt.get(t)===r:Ft.has(r))return;t?Pt.set(t,r):Ft.add(r);let i=e.budget.deviceMemoryGiB===null?`a conservative fallback`:`${e.budget.deviceMemoryGiB} GiB of reported device RAM`;console.warn(`[HEPR] Raster GPU demand is estimated at ${Math.ceil(e.unscaledBytes/St)} MiB; the automatic resident raster target is ${Math.ceil(e.availableBytes/St)} MiB, estimated from ${i}, not measured VRAM. `+(n?`Using ${e.compressionFormats.find(Boolean)} GPU compression for ${n} eligible raster(s). `:``)+(e.resolutionScale<1?`Drawing rasters at reduced resolution (${Math.ceil(e.estimatedBytes/St)} MiB estimated). `:``)+(e.overBudget?`Keeping lossless packed rasters and minimum textures even though they exceed this heuristic target.`:``))}const Lt=Uint8Array.from({length:256},(e,t)=>{let n=0;for(let e=0;e<8;e++)n|=(t>>e&1)<<7-e;return n}),Rt=Uint8Array.from({length:256},(e,t)=>(t&15)<<4|t>>4);function*zt(e,t,n,r,i){let a=P(t,n),o=i?8:1,s=(i?t*n:Math.ceil(t/8)*n)+r.data.length,c=[{width:t,height:n,rowBytes:0,byteOffset:0},...a.levels],l=5+c.length,u=c.reduce((e,t)=>e+Math.ceil(t.width/32)*Math.ceil(t.height/32),0);if(u>5e5||(l+u)*4>=s*.95)return;let d=new Uint32Array(Math.floor(s*.95/4));d.set([t,n,c.length,32,o]);let f=l+u,p=l;for(let e=0;e<c.length;e++)d[5+e]=p,p+=Math.ceil(c[e].width/32)*Math.ceil(c[e].height/32);let m=e=>{if(f+e.length>d.length)throw Bt;let t=f;return d.set(e,f),f+=e.length,t},h=/* @__PURE__ */ new Map,g=new Uint32Array(32*o),_=/* @__PURE__ */ new Uint32Array(128),v=0,y=0,b=0,x=(e,t)=>{let n=e[0]&(1<<t)-1,r=n*(t===1?4294967295:t===4?286331153:16843009)>>>0,i=2166136261,a=!0;for(let t of e)t!==r&&(a=!1),i=Math.imul(i^t,16777619);if(a)return v++,(2147483648|n)>>>0;let o=`${t}:${i>>>0}`,s=h.get(o)??[];for(let t of s)if(e.every((e,n)=>d[t+n]===e))return y++,t;if(s.length>=32)throw Bt;let c=m(e);return s.push(c),h.set(o,s),c},S=e.data,C,w=/* @__PURE__ */ new Map,T=i?void 0:e.symbols;if(T&&T.placements instanceof Int32Array&&Array.isArray(T.symbols)&&T.placements.length%3==0){S=new Uint8Array(e.data),C=Array.from({length:Math.ceil(t/32)*Math.ceil(n/32)},()=>[]);let r=Math.ceil(t/8),i=Math.ceil(t/32),a=!0,o=0,s=Math.min(2e8,t*n*8);for(let c=0;c<T.placements.length&&a;c+=3){let l=T.placements[c],u=T.placements[c+1],d=T.symbols[T.placements[c+2]];if(!d||!Number.isSafeInteger(d.width)||!Number.isSafeInteger(d.height)||d.width<1||d.height<1||d.width>65535||d.height>65535||!(d.data instanceof Uint8Array)||d.data.length<Math.ceil(d.width/8)*d.height){a=!1;break}if(l>=t||u>=n||l+d.width<=0||u+d.height<=0)continue;let f=Math.ceil(d.width/8);for(let i=Math.max(0,-u);i<Math.min(d.height,n-u);i++){if((o+=Math.min(d.width,t-l)-Math.max(0,-l))>s){a=!1;break}for(let n=Math.max(0,-l);n<Math.min(d.width,t-l);n++){if(!(d.data[i*f+(n>>3)]&128>>(n&7)))continue;let t=(u+i)*r+(l+n>>3),o=128>>(l+n&7);if(e.data[t]&o){a=!1;break}S[t]|=o}yield}for(let e=Math.max(0,Math.floor(u/32));e<Math.min(Math.ceil(n/32),Math.ceil((u+d.height)/32));e++)for(let t=Math.max(0,Math.floor(l/32));t<Math.min(i,Math.ceil((l+d.width)/32));t++){let n=C[e*i+t];n.length<=8&&n.push(c)}}a||(C=void 0,S=e.data)}try{for(let n=0;n<c.length;n++){let a=c[n],s=n?4:o,l=Math.ceil(a.width/32),u=Math.ceil(a.height/32);for(let o=0;o<u;o++)for(let c=0;c<l;c++){let u=o*l+c,f=n===0?C?.[u]:void 0,p=!!f?.length&&f.length<=8,h=n?_:g;if((c+1)*32<=a.width&&(o+1)*32<=a.height){if(s===1){let n=p?S:e.data,r=Math.ceil(t/8),i=o*32*r+c*4;for(let e=0;e<32;e++,i+=r)h[e]=Lt[n[i]]|Lt[n[i+1]]<<8|Lt[n[i+2]]<<16|Lt[n[i+3]]<<24}else{let e=n?r.data:i,l=n?a.rowBytes:t,u=32*s/8,d=(n?a.byteOffset:0)+o*32*l+c*u,f=0;for(let t=0;t<32;t++,d+=l)for(let t=0;t<u;t+=4){let n=d+t;h[f++]=s===4?Rt[e[n]]|Rt[e[n+1]]<<8|Rt[e[n+2]]<<16|Rt[e[n+3]]<<24:e[n]|e[n+1]<<8|e[n+2]<<16|e[n+3]<<24}}}else{h.fill(0);for(let l=0;l<32;l++)for(let u=0;u<32;u++){let d=Math.min(a.width-1,c*32+u),f=Math.min(a.height-1,o*32+l),m;m=n?r.data[a.byteOffset+f*a.rowBytes+(d>>1)]>>(d&1?0:4)&15:i?i[f*t+d]:(p?S:e.data)[f*Math.ceil(t/8)+(d>>3)]>>7-(d&7)&1;let g=(l*32+u)*s;h[g>>>5]|=m<<(g&31)}}let v=x(h,s);if(p&&T){let e=[v,f.length];for(let t of f){let n=T.placements[t+2],r=T.symbols[n],i=w.get(n);if(i===void 0){let e=new Uint32Array(2+Math.ceil(r.data.length/4));e[0]=r.width,e[1]=r.height;for(let t=0;t<r.data.length;t++)e[2+(t>>2)]|=r.data[t]<<(t&3)*8;i=m(e),w.set(n,i)}e.push(i,T.placements[t]>>>0,T.placements[t+1]>>>0)}v=(1073741824|m(e))>>>0,b++}d[d[5+n]+u]=v,yield}}let a=Math.min(Math.max(t,n),Math.ceil(Math.sqrt(f))),l=Math.ceil(f/a);if(a*l*4>=s*.95)return;let u=new Uint8Array(a*l*4),p=new DataView(u.buffer);for(let e=0;e<f;e++)p.setUint32(e*4,d[e],!0),e&4095||(yield);return{width:a,height:l,data:u,uniformBlocks:v,reusedBlocks:y,symbolBlocks:b}}catch(e){if(e!==Bt)throw e}}const Bt=Symbol(`compact texture is not smaller`);function Vt(e,t,n,r,i){let a=N(zt({...e,symbols:void 0},t,n,r,i));if(!e.symbols||i)return a;let o=N(zt(e,t,n,r));return o&&(!a||o.data.length<a.data.length)?o:a}async function Ht(e,t,n,r,i,a){let o=await F(zt({...e,symbols:void 0},t,n,r,i),a);if(!e.symbols||i)return o;let s=await F(zt(e,t,n,r),a);return s&&(!o||s.data.length<o.data.length)?s:o}async function Ut(e,t,n){n?.throwIfAborted();let r=e.monochrome;if(!r){let r=await ne(e,t,n);return n?.throwIfAborted(),{plan:t,pixels:r}}let i=[],a=[],o=[],s=[];if(t.width===e.width&&t.height===e.height){for(let i of t.tiles){n?.throwIfAborted();let t=O(r,e.width,e.height,i);a.push(t);let c=await j(t,i.width,i.height,n);o.push(c),s.push(await Ht(t,i.width,i.height,c,void 0,n))}return n?.throwIfAborted(),{plan:t,pixels:i,monochromeTiles:a,coverageAtlases:o,compactAtlases:s}}let c=await M(r,e.width,e.height,t.width,t.height,n);for(let e of t.tiles){n?.throwIfAborted();let a=c;if(e.width!==t.width||e.height!==t.height){a=new Uint8Array(e.width*e.height);for(let r=0;r<e.height;r++){n?.throwIfAborted();let i=(e.y+r)*t.width+e.x;a.set(c.subarray(i,i+e.width),r*e.width)}}i.push(a);let l=await S(a,e.width,e.height,n);o.push(l),s.push(await Ht(r,e.width,e.height,l,a,n))}return n?.throwIfAborted(),{plan:t,pixels:i,coverageAtlases:o,compactAtlases:s}}const Wt=String.raw`#version 300 es
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
`,Gt=String.raw`#version 300 es
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
`,Kt=String.raw`#version 300 es
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
`,qt=4194304;function Jt(e){try{if(new Uint8Array(Uint32Array.of(16909060).buffer)[0]!==4||typeof e.getExtension!=`function`||typeof e.texStorage2D!=`function`||typeof e.readPixels!=`function`||typeof e.compressedTexSubImage2D!=`function`)return{bc7:!1,astc4x4:!1};let t=e.getExtension(`EXT_texture_compression_bptc`),n=e.getExtension(`WEBGL_compressed_texture_astc`);return{bc7:typeof t?.COMPRESSED_RGBA_BPTC_UNORM_EXT==`number`,astc4x4:typeof n?.COMPRESSED_RGBA_ASTC_4x4_KHR==`number`&&(!n.getSupportedProfiles||n.getSupportedProfiles().includes(`ldr`))}}catch{return{bc7:!1,astc4x4:!1}}}var Yt=class{gl;programs=/* @__PURE__ */ new Map;failed=/* @__PURE__ */ new Set;available;workspace=null;wasContextLost=!1;onContextLost=()=>{this.wasContextLost=!0,this.releaseWorkspace(),this.releasePrograms()};constructor(e){this.gl=e,this.available=Jt(e),e.canvas?.addEventListener?.(`webglcontextlost`,this.onContextLost)}get capabilities(){return this.refreshContext()?{bc7:this.available.bc7&&!this.failed.has(`bc7`),astc4x4:this.available.astc4x4&&!this.failed.has(`astc-4x4`)}:{bc7:!1,astc4x4:!1}}get workspaceBytes(){return this.workspace?.bytes??0}encode(e,n,r,i,a=qt,o){t(o);let s=this.capabilities;if(!(i===`bc7`?s.bc7:s.astc4x4)||typeof this.gl.getBufferSubData!=`function`)throw Error(`WebGL ${i} block readback is unavailable.`);let c=this.gl,l=Qt(c);try{let s=gt(n,r,i);if(s[0].width>Number(c.getParameter(c.MAX_TEXTURE_SIZE))||s[0].height>Number(c.getParameter(c.MAX_TEXTURE_SIZE)))throw Error(`Block-aligned raster exceeds this context's texture dimension limit.`);let l=new Uint8Array(s.reduce((e,t)=>e+t.byteLength,0)),u=this.getProgram(i);$t(c);let d=this.getWorkspace(a);c.bindFramebuffer(c.FRAMEBUFFER,d.framebuffer),c.readBuffer(c.COLOR_ATTACHMENT0),c.useProgram(u.program),c.bindVertexArray(d.vao),c.uniform1i(u.source,0),c.uniform1i(u.flip,0);let f=0;for(let a of vt(e,n,r,o)){let e=Math.ceil(a.width/4);for(let n=0;n<a.height;n+=d.blockRows*4){t(o);let r=Math.min(d.blockRows*4,a.height-n),p=Math.ceil(r/4),m=e*p*16;c.bindTexture(c.TEXTURE_2D,d.source),c.texSubImage2D(c.TEXTURE_2D,0,0,0,a.width,r,c.RGBA,c.UNSIGNED_BYTE,a.data.subarray(n*a.width*4,(n+r)*a.width*4)),c.uniform2i(u.size,a.width,r),c.viewport(0,0,e,p),c.drawArrays(c.TRIANGLES,0,3),c.bindBuffer(c.PIXEL_PACK_BUFFER,d.buffer),c.readPixels(0,0,e,p,c.RGBA_INTEGER,c.UNSIGNED_INT,0);let h=s[f].byteOffset+n/4*e*16;c.getBufferSubData(c.PIXEL_PACK_BUFFER,0,l.subarray(h,h+m)),Xt(c,`${i} mip ${f} band readback`)}f++}return t(o),l}catch(e){throw o?.aborted||this.failed.add(i),this.releaseWorkspace(),e}finally{en(c,l)}}uploadEncoded(e,t,n,r){let i=gt(t,n,r),a=i.reduce((e,t)=>e+t.byteLength,0);if(!(e instanceof Uint8Array)||e.length!==a)throw RangeError(`Incorrect encoded raster mip byte length.`);let o=this.capabilities;if(!(r===`bc7`?o.bc7:o.astc4x4))throw Error(`WebGL ${r} compression is unavailable.`);let s=this.gl,c=Qt(s),l=i[0],u=null;try{if(l.width>Number(s.getParameter(s.MAX_TEXTURE_SIZE))||l.height>Number(s.getParameter(s.MAX_TEXTURE_SIZE)))throw Error(`Block-aligned raster exceeds this context's texture dimension limit.`);$t(s),u=B(s.createTexture(),`compressed texture`),s.bindTexture(s.TEXTURE_2D,u);let o=r===`bc7`?36492:37808;s.texStorage2D(s.TEXTURE_2D,i.length,o,l.width,l.height),s.texParameteri(s.TEXTURE_2D,s.TEXTURE_MIN_FILTER,s.LINEAR_MIPMAP_LINEAR),s.texParameteri(s.TEXTURE_2D,s.TEXTURE_MAG_FILTER,s.LINEAR),s.texParameteri(s.TEXTURE_2D,s.TEXTURE_WRAP_S,s.CLAMP_TO_EDGE),s.texParameteri(s.TEXTURE_2D,s.TEXTURE_WRAP_T,s.CLAMP_TO_EDGE),s.texParameteri(s.TEXTURE_2D,s.TEXTURE_MAX_LEVEL,i.length-1),Xt(s,`compressed texture allocation`);for(let[t,n]of i.entries())s.compressedTexSubImage2D(s.TEXTURE_2D,t,0,0,n.width,n.height,o,e.subarray(n.byteOffset,n.byteOffset+n.byteLength)),Xt(s,`${r} encoded mip ${t} upload`);return{texture:u,estimatedBytes:a,uvScale:[t/l.width,n/l.height]}}catch(e){throw u&&s.deleteTexture(u),this.failed.add(r),this.releaseWorkspace(),e}finally{en(s,c)}}upload(e,t,n,r,i=qt){let a=this.capabilities;if(!(r===`bc7`?a.bc7:a.astc4x4))throw Error(`WebGL ${r} compression is unavailable.`);let o=this.gl,s=Qt(o),c=null;try{let a=gt(t,n,r),s=a[0];if(s.width>Number(o.getParameter(o.MAX_TEXTURE_SIZE))||s.height>Number(o.getParameter(o.MAX_TEXTURE_SIZE)))throw Error(`Block-aligned raster exceeds this context's texture dimension limit.`);let l=this.getProgram(r);$t(o);let u=this.getWorkspace(i);c=B(o.createTexture(),`compressed texture`),o.bindTexture(o.TEXTURE_2D,c);let d=r===`bc7`?36492:37808;o.texStorage2D(o.TEXTURE_2D,a.length,d,s.width,s.height),o.texParameteri(o.TEXTURE_2D,o.TEXTURE_MIN_FILTER,o.LINEAR_MIPMAP_LINEAR),o.texParameteri(o.TEXTURE_2D,o.TEXTURE_MAG_FILTER,o.LINEAR),o.texParameteri(o.TEXTURE_2D,o.TEXTURE_WRAP_S,o.CLAMP_TO_EDGE),o.texParameteri(o.TEXTURE_2D,o.TEXTURE_WRAP_T,o.CLAMP_TO_EDGE),o.texParameteri(o.TEXTURE_2D,o.TEXTURE_MAX_LEVEL,a.length-1),Xt(o,`compressed texture allocation`),o.bindFramebuffer(o.FRAMEBUFFER,u.framebuffer),o.readBuffer(o.COLOR_ATTACHMENT0),o.useProgram(l.program),o.bindVertexArray(u.vao),o.uniform1i(l.source,0),o.uniform1i(l.flip,0);let f=0;for(let i of vt(e,t,n)){let e=Math.ceil(i.width/4);for(let t=0;t<i.height;t+=u.blockRows*4){let n=Math.min(u.blockRows*4,i.height-t),a=Math.ceil(n/4),s=e*a*16;o.bindBuffer(o.PIXEL_UNPACK_BUFFER,null),o.bindTexture(o.TEXTURE_2D,u.source),o.texSubImage2D(o.TEXTURE_2D,0,0,0,i.width,n,o.RGBA,o.UNSIGNED_BYTE,i.data.subarray(t*i.width*4,(t+n)*i.width*4)),o.uniform2i(l.size,i.width,n),o.viewport(0,0,e,a),o.drawArrays(o.TRIANGLES,0,3),o.bindBuffer(o.PIXEL_PACK_BUFFER,u.buffer),o.readPixels(0,0,e,a,o.RGBA_INTEGER,o.UNSIGNED_INT,0),o.bindBuffer(o.PIXEL_UNPACK_BUFFER,u.buffer),o.bindTexture(o.TEXTURE_2D,c),o.compressedTexSubImage2D(o.TEXTURE_2D,f,0,t,i.width,n,d,s,0),Xt(o,`${r} mip ${f} band upload`)}f++}return{texture:c,estimatedBytes:_t(t,n,r),uvScale:[t/s.width,n/s.height]}}catch(e){throw c&&o.deleteTexture(c),this.failed.add(r),this.releaseWorkspace(),e}finally{en(o,s)}}releaseWorkspace(){let e=this.workspace;if(this.workspace=null,!e)return;let t=this.gl;t.deleteTexture(e.source),t.deleteTexture(e.output),t.deleteFramebuffer(e.framebuffer),t.deleteBuffer(e.buffer),t.deleteVertexArray(e.vao)}dispose(){this.releaseWorkspace(),this.releasePrograms(),this.gl.canvas?.removeEventListener?.(`webglcontextlost`,this.onContextLost)}releasePrograms(){for(let e of this.programs.values())this.gl.deleteProgram(e.program);this.programs.clear()}refreshContext(){return this.gl.isContextLost?.()?(this.onContextLost(),!1):(this.wasContextLost&&(this.wasContextLost=!1,this.failed.clear(),this.available=Jt(this.gl)),!0)}getProgram(e){let t=this.programs.get(e);if(t)return t;let n=this.gl,r=[],i=null;try{for(let[t,i]of[[n.VERTEX_SHADER,Kt],[n.FRAGMENT_SHADER,e===`bc7`?Wt:Gt]]){let e=B(n.createShader(t),`encoder shader`);if(r.push(e),n.shaderSource(e,i),n.compileShader(e),!n.getShaderParameter(e,n.COMPILE_STATUS))throw Error(n.getShaderInfoLog(e)??`Encoder shader compilation failed.`)}i=B(n.createProgram(),`encoder program`);for(let e of r)n.attachShader(i,e);if(n.linkProgram(i),!n.getProgramParameter(i,n.LINK_STATUS))throw Error(n.getProgramInfoLog(i)??`Encoder program linking failed.`);let t={program:i,source:B(n.getUniformLocation(i,`uSrc`),`source uniform`),size:B(n.getUniformLocation(i,`uSrcSize`),`size uniform`),flip:B(n.getUniformLocation(i,`uFlipY`),`flip uniform`)};return this.programs.set(e,t),t}catch(e){throw i&&n.deleteProgram(i),e}finally{for(let e of r)n.deleteShader(e)}}getWorkspace(e){let t=Math.min(qt,Math.max(0,Math.floor(e)));if(this.workspace&&this.workspace.bytes<=t)return this.workspace;this.releaseWorkspace();let n=this.gl,r=Math.floor(Number(n.getParameter(n.MAX_TEXTURE_SIZE))/4)*4,i=r/4,a=r*4*4+i*16*2,o=Math.min(Math.floor(Number(n.getParameter(n.MAX_TEXTURE_SIZE))/4),Math.floor(t/a));if(o<1)throw Error(`Insufficient bounded workspace for one compressed block row.`);let s=null,c=null,l=null,u=null,d=null;try{if(s=B(n.createTexture(),`encoder source texture`),c=B(n.createTexture(),`encoder output texture`),l=B(n.createFramebuffer(),`encoder framebuffer`),u=B(n.createBuffer(),`encoder pixel buffer`),d=B(n.createVertexArray(),`encoder vertex array`),n.bindTexture(n.TEXTURE_2D,s),n.texStorage2D(n.TEXTURE_2D,1,n.RGBA8,r,o*4),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_MIN_FILTER,n.NEAREST),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_MAG_FILTER,n.NEAREST),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_WRAP_S,n.CLAMP_TO_EDGE),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_WRAP_T,n.CLAMP_TO_EDGE),n.bindTexture(n.TEXTURE_2D,c),n.texStorage2D(n.TEXTURE_2D,1,n.RGBA32UI,i,o),n.bindFramebuffer(n.FRAMEBUFFER,l),n.framebufferTexture2D(n.FRAMEBUFFER,n.COLOR_ATTACHMENT0,n.TEXTURE_2D,c,0),n.drawBuffers([n.COLOR_ATTACHMENT0]),n.checkFramebufferStatus(n.FRAMEBUFFER)!==n.FRAMEBUFFER_COMPLETE)throw Error(`Integer encoder framebuffer is incomplete.`);return n.bindBuffer(n.PIXEL_PACK_BUFFER,u),n.bufferData(n.PIXEL_PACK_BUFFER,i*o*16,n.STREAM_COPY),Xt(n,`encoder workspace allocation`),this.workspace={source:s,output:c,framebuffer:l,buffer:u,vao:d,width:r,blockRows:o,bytes:a*o}}catch(e){throw n.deleteTexture(s),n.deleteTexture(c),n.deleteFramebuffer(l),n.deleteBuffer(u),n.deleteVertexArray(d),e}}};function B(e,t){if(e==null)throw Error(`Unable to allocate ${t}.`);return e}function Xt(e,t){let n=e.getError();if(n!==e.NO_ERROR)throw Error(`${t} failed (WebGL error ${n}).`)}function Zt(e){return[e.PACK_ALIGNMENT,e.PACK_ROW_LENGTH,e.PACK_SKIP_PIXELS,e.PACK_SKIP_ROWS,e.UNPACK_ALIGNMENT,e.UNPACK_ROW_LENGTH,e.UNPACK_IMAGE_HEIGHT,e.UNPACK_SKIP_PIXELS,e.UNPACK_SKIP_ROWS,e.UNPACK_SKIP_IMAGES,e.UNPACK_FLIP_Y_WEBGL,e.UNPACK_PREMULTIPLY_ALPHA_WEBGL,e.UNPACK_COLORSPACE_CONVERSION_WEBGL]}function Qt(e){let t=e.getParameter(e.ACTIVE_TEXTURE);return e.activeTexture(e.TEXTURE0),{activeTexture:t,texture:e.getParameter(e.TEXTURE_BINDING_2D),toggles:[e.BLEND,e.DEPTH_TEST,e.STENCIL_TEST,e.SCISSOR_TEST,e.CULL_FACE,e.DITHER,e.RASTERIZER_DISCARD].map(t=>[t,e.isEnabled(t)]),viewport:e.getParameter(e.VIEWPORT),colorMask:e.getParameter(e.COLOR_WRITEMASK),program:e.getParameter(e.CURRENT_PROGRAM),sampler:e.getParameter(e.SAMPLER_BINDING),vao:e.getParameter(e.VERTEX_ARRAY_BINDING),drawFramebuffer:e.getParameter(e.DRAW_FRAMEBUFFER_BINDING),readFramebuffer:e.getParameter(e.READ_FRAMEBUFFER_BINDING),pack:e.getParameter(e.PIXEL_PACK_BUFFER_BINDING),unpack:e.getParameter(e.PIXEL_UNPACK_BUFFER_BINDING),pixels:Zt(e).map(t=>[t,e.getParameter(t)])}}function $t(e){for(let t of[e.BLEND,e.DEPTH_TEST,e.STENCIL_TEST,e.SCISSOR_TEST,e.CULL_FACE,e.DITHER,e.RASTERIZER_DISCARD])e.disable(t);e.colorMask(!0,!0,!0,!0),e.bindSampler(0,null),e.bindBuffer(e.PIXEL_UNPACK_BUFFER,null);for(let t of Zt(e))e.pixelStorei(t,t===e.PACK_ALIGNMENT||t===e.UNPACK_ALIGNMENT?1:t===e.UNPACK_COLORSPACE_CONVERSION_WEBGL?e.NONE:0)}function en(e,t){e.bindFramebuffer(e.DRAW_FRAMEBUFFER,t.drawFramebuffer),e.bindFramebuffer(e.READ_FRAMEBUFFER,t.readFramebuffer),e.bindBuffer(e.PIXEL_PACK_BUFFER,t.pack),e.bindBuffer(e.PIXEL_UNPACK_BUFFER,t.unpack);for(let[n,r]of t.pixels)e.pixelStorei(n,r);for(let[n,r]of t.toggles)r?e.enable(n):e.disable(n);e.viewport(t.viewport[0],t.viewport[1],t.viewport[2],t.viewport[3]),e.colorMask(t.colorMask[0],t.colorMask[1],t.colorMask[2],t.colorMask[3]),e.useProgram(t.program),e.bindVertexArray(t.vao),e.bindSampler(0,t.sampler),e.activeTexture(e.TEXTURE0),e.bindTexture(e.TEXTURE_2D,t.texture),e.activeTexture(t.activeTexture)}const tn=()=>({conditions:/* @__PURE__ */ new Set,backdrop:!1,all:!1});function V(e,t){for(let n of t.conditions)e.conditions.add(n);e.backdrop||=t.backdrop,e.all||=t.all}var nn=class{page;commands=/* @__PURE__ */ new WeakMap;resources=/* @__PURE__ */ new Map;active=/* @__PURE__ */ new Set;constructor(e){this.page=e}span(e,t){let n=this.page.displayProgram.groups[this.page.displayProgram.rootGroupIndex],r=tn();if(!n||e<0||t<1||e+t>n.commands.length)r.all=!0;else{for(let i=e;i<e+t;i++)V(r,this.command(n.commands[i]));if(n.softMaskGroupIndex>=0&&V(r,this.group(n.softMaskGroupIndex)),r.backdrop)for(let t=0;t<e;t++)V(r,this.command(n.commands[t]))}return r.all?Uint32Array.from({length:this.page.stores.optionalContent.defaultVisible.length},(e,t)=>t):Uint32Array.from(r.conditions)}resource(e,t){let n=this.resources.get(e);if(n)return n;let r=tn();return this.active.has(e)||this.active.size>64?(r.all=!0,r):(this.active.add(e),t(r),this.active.delete(e),this.resources.set(e,r),r)}group(e){return this.resource(`group:${e}`,t=>{let n=this.page.displayProgram.groups[e];if(!n){t.all=!0;return}t.backdrop=n.blendMode!==`Normal`||n.knockout||n.backdropPaintIndex>=0||!n.isolated,n.softMaskGroupIndex>=0&&V(t,this.group(n.softMaskGroupIndex));for(let e of n.commands)V(t,this.command(e))})}program(e){return this.resource(`program:${e}`,t=>{let n=this.page.displayProgram.programs[e];if(!n){t.all=!0;return}for(let e of n.commands)V(t,this.command(e))})}pattern(e){return this.resource(`pattern:${e}`,t=>{let n=this.page.stores.patterns.programIndices[e];n===void 0?t.all=!0:n>=0&&V(t,this.program(n))})}paint(t){return this.resource(`paint:${t}`,n=>{this.page.stores.paints.kinds[t]===e.Pattern&&V(n,this.pattern(this.page.stores.paints.resourceIndices[t]))})}command(e){let t=this.commands.get(e);if(t)return t;let n=tn();if(e.optionalContentIndex>=0&&n.conditions.add(e.optionalContentIndex),e.kind===`invoke-group`)V(n,this.group(e.groupIndex));else if(e.kind===`invoke-program`)V(n,this.program(e.programIndex)),e.type3PaintIndex>=0&&V(n,this.paint(e.type3PaintIndex));else if(`paintIndex`in e&&e.paintIndex>=0&&V(n,this.paint(e.paintIndex)),`fillPaintIndex`in e&&(e.fillPaintIndex>=0&&V(n,this.paint(e.fillPaintIndex)),e.strokePaintIndex>=0&&V(n,this.paint(e.strokePaintIndex))),e.source===`patterns`)for(let t=e.first;t<e.first+e.count;t++)V(n,this.pattern(t));else e.source===`glyphs`&&V(n,this.resource(`glyph-programs`,e=>{for(let t of new Set(this.page.stores.fonts.type3ProgramIndices))t>=0&&V(e,this.program(t))}));return this.commands.set(e,n),n}};function rn(e,t){let n=e.page.stores.optionalContent,r=new Uint8Array(n.defaultVisible.length);if(e.optionalContentConditions.length!==r.length)throw RangeError(`Retained visibility map has an invalid length.`);for(let n=0;n<r.length;n++){let i=e.optionalContentConditions[n];if(i<-1||i>=t.conditions.length)throw RangeError(`Retained visibility map references an unknown condition.`);r[n]=+(i<0||t.conditions[i]!==0)}return{...e.page,stores:{...e.page.stores,optionalContent:{...n,defaultVisible:r}}}}var an=class{scene;nodes=[];dependencies=[];renderSpan;layers=/* @__PURE__ */ new Map;pageVisibility;visible=/* @__PURE__ */ new Set;generation=0;disposed=!1;constructor(e,t){this.scene=e,this.renderSpan=t??(async(e,t,n,r)=>{let{renderNativeRetainedCommandSpan:i}=await import(`./pdfWorkerEntry-C2M39atj.js`).then(e=>e.st);return i(e,t,n,r)});let n=e.retainedPages?.map(e=>new nn(e.page))??[],r=t=>{for(let i of t)i.kind===`retained`?(this.nodes.push(i),this.layers.set(i.rasterIndex,e.rasterLayers[i.rasterIndex]),this.dependencies.push(n[i.retainedPage].span(i.firstCommand,i.count))):i.kind===`group`&&(r(i.children),i.softMask&&r(i.softMask.children))};e.paintGraph&&r(e.paintGraph.roots),this.pageVisibility=e.retainedPages?.map(e=>e.page.stores.optionalContent.defaultVisible.slice())??[],this.visible=this.visibleSlots(L(e))}getLayers(){return new Map(this.layers)}async prepare(e,t){if(this.disposed)throw Error(`Retained page replay has been disposed.`);t.signal.throwIfAborted();let n=++this.generation,r=new Map(this.layers),i=/* @__PURE__ */ new Map,a=this.scene.retainedPages?.map(t=>rn(t,e))??[],o=a.map(e=>e.stores.optionalContent.defaultVisible),s=this.visibleSlots(e),c=e=>{if(!(n!==this.generation||this.disposed))try{t.onProgress?.(e)}catch{}};c(0);try{for(let e=0;e<this.nodes.length;e++){t.signal.throwIfAborted();let n=this.nodes[e],r=this.scene.rasterLayers[n.rasterIndex],l=o[n.retainedPage],u=this.pageVisibility[n.retainedPage],d=this.dependencies[e].some(e=>l[e]!==u[e]);if(!s.has(n.rasterIndex))this.visible.has(n.rasterIndex)&&i.set(n.rasterIndex,{...r,monochrome:void 0,width:1,height:1,data:/* @__PURE__ */ new Uint8Array(4)});else if(d||!this.visible.has(n.rasterIndex)){await ue(new Promise(e=>setTimeout(e,0)),t.signal);let e=await ue(this.renderSpan(a[n.retainedPage],n.firstCommand,n.count,t.signal),t.signal);if(t.signal.throwIfAborted(),e){let t=this.scene.retainedPages[n.retainedPage].matrix,a=e.matrix,o=new Float32Array([t[0]*a[0]+t[2]*a[1],t[1]*a[0]+t[3]*a[1],t[0]*a[2]+t[2]*a[3],t[1]*a[2]+t[3]*a[3],t[0]*a[4]+t[2]*a[5]+t[4],t[1]*a[4]+t[3]*a[5]+t[5]]);i.set(n.rasterIndex,{...e,matrix:o,paintOrder:r.paintOrder,pageIndex:r.pageIndex})}else i.set(n.rasterIndex,{...r,monochrome:void 0,width:1,height:1,data:/* @__PURE__ */ new Uint8Array(4)})}c(Math.floor((e+1)/this.nodes.length*100))}for(let[e,t]of i)r.set(e,t);return{layers:i,commit:()=>{if(t.signal.throwIfAborted(),this.disposed||n!==this.generation)throw new DOMException(`Retained replay superseded.`,`AbortError`);this.layers=r,this.pageVisibility=o,this.visible=s}}}finally{c(null)}}visibleSlots(e){return new Set(Ae(this.scene,t=>t===void 0||e.conditions[t]!==0).filter(e=>e.kind===`retained`).map(e=>e.kind===`retained`?e.node.rasterIndex:-1))}dispose(){this.disposed=!0,this.generation++,this.layers.clear(),this.visible.clear(),this.pageVisibility=[]}};const on=`
  return smoothstep(-aaWorld, aaWorld, halfWidth - distanceValue)
    - smoothstep(-aaWorld, aaWorld, -halfWidth - distanceValue);
`,sn=`
float heprStrokeCoverage(float distanceValue, float halfWidth, float aaWorld) {
${on}}
`,cn=`
fn heprStrokeCoverage(distanceValue: f32, halfWidth: f32, aaWorld: f32) -> f32 {
${on}}
`,ln=`
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
`,un=`
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
`,dn=`
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
`,fn=`
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
`,pn=`
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
`,mn=`
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
`,hn=`flat in float vVectorClipIndex;
`+pn.replaceAll(`int(uVectorClipIndex)`,`int(uVectorClipIndex < -1.5 ? vVectorClipIndex : uVectorClipIndex)`),gn=`
uint heprRasterClipRectSamples(vec4 bounds, vec2 point) {
  bool inside = point.x >= bounds.x && point.y >= bounds.y && point.x < bounds.z && point.y < bounds.w;
  return inside ? 0xFFFFu : 0u;
}
`+pn.replace(`heprClipRectSamples(heprClipTexel(int(node.y)), sampleX, sampleY)`,`heprRasterClipRectSamples(heprClipTexel(int(node.y)), point)`).replace(`heprClipPolygonSamples(node, sampleX, sampleY, span);`,`heprRasterClipPolygonSamples(node, point, sampleX, sampleY, span);`).replace(`float heprVectorClipAA(vec2 point, float aaWidth)`,`
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
float heprVectorClipAA(vec2 point, float aaWidth)`);mn.replace(`heprClipRectSamples(heprClipTexel(clipTexture, i32(node.y)), sampleX, sampleY)`,`heprRasterClipRectSamples(heprClipTexel(clipTexture, i32(node.y)), point)`).replace(`heprClipPolygonSamples(clipTexture, node, sampleX, sampleY, span);`,`heprRasterClipPolygonSamples(clipTexture, node, point, sampleX, sampleY, span);`)+``;const _n=`
vec4 heprThreeEncodeOutputColor(vec4 color) {
  
  
  return color;
}

float heprThreeLinearCoverageToOutputAlpha(float coverage) {
  return clamp(coverage, 0.0, 1.0);
}
`,vn=`#version 300 es
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
`,yn=`#version 300 es
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

${_n}

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

${hn}
${sn}

float heprStrokeLodAlpha(float alpha, float primitiveType) {

  if (primitiveType >= 0.0) { return alpha; }
  return 1.0 - pow(1.0 - clamp(alpha, 0.0, 1.0), max(1.0, 1.0 - primitiveType));
}


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
`,bn=`#version 300 es
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

${un}

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
`,xn=`#version 300 es
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

${_n}

const float FILL_PRIMITIVE_QUADRATIC = 1.0;

ivec2 coordFromIndex(int index, ivec2 sizeValue) {
  int x = index % sizeValue.x;
  int y = index / sizeValue.x;
  return ivec2(x, y);
}

${ln}

vec4 heprCellFetchA(int index) {
  return texelFetch(uFillSegmentTexA, coordFromIndex(index, uFillSegmentTexSize), 0);
}

vec4 heprCellFetchB(int index) {
  return texelFetch(uFillSegmentTexB, coordFromIndex(index, uFillSegmentTexSize), 0);
}

${fn}

${hn}



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
`,Sn=`#version 300 es
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

${un}

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
`,Cn=`#version 300 es
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

${_n}

const float TEXT_PRIMITIVE_QUADRATIC = 1.0;

ivec2 coordFromIndex(int index, ivec2 sizeValue) {
  int x = index % sizeValue.x;
  int y = index / sizeValue.x;
  return ivec2(x, y);
}

${ln}

${hn}

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
`,wn=`#version 300 es
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
`,Tn=`#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uRasterTex;
uniform float uRasterOpacity;
in vec2 vUv;
in vec2 vWorld;
out vec4 outColor;

${gn}

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
`;function En(e,t){for(let[n,r]of t){if(!Number.isSafeInteger(n)||n<0||n>=e.rasterLayers.length||!Number.isSafeInteger(r.width)||!Number.isSafeInteger(r.height)||r.width<1||r.height<1||!Number.isSafeInteger(r.width*r.height*4)||r.opacity!==void 0&&(!Number.isFinite(r.opacity)||r.opacity<0||r.opacity>1)||r.interpolate!==void 0&&typeof r.interpolate!=`boolean`||(r.monochrome?!(r.monochrome.data instanceof Uint8Array)||!(r.monochrome.colors instanceof Uint8Array)||r.monochrome.data.length!==Math.ceil(r.width/8)*r.height||r.monochrome.colors.length!==8:r.data.length!==r.width*r.height*4)||r.matrix.length!==6||!r.matrix.every(Number.isFinite))throw RangeError(`Invalid raster replacement.`);r.repeat&&I(r.repeat)}}function Dn(e,t,n=`box`){if(!e.drawRuns||e.paintGraph||e.retainedPages?.length||!Number.isFinite(t)||t<4)return[];let r=Math.min(1024,Math.floor(t/2)),i=Math.min(512,Math.floor(t)),a=[],o=16777216,s=/* @__PURE__ */ new Set;for(let t of e.drawRuns){if(t.kind!==`raster`||t.blendMode)continue;let c=Math.min(e.rasterLayers.length,t.first+t.count),l=t.first;for(;l<c;){if(s.has(l)||!On(e.rasterLayers[l],r)){l++;continue}let t=0,u=0;for(;l+t<c&&t<i&&!s.has(l+t);){let n=e.rasterLayers[l+t];if(!On(n,r))break;let i=Math.max(u,n.width*2);if((i*4+32)*(t+1)>o)break;u=i,t++}if(t>=4){let r=new Uint8Array(u*t*4),i=new Float32Array(t*8);for(let a=0;a<t;a++){let t=e.rasterLayers[l+a];i.set(t.matrix.subarray(0,6),a*8),i[a*8+6]=t.width,i[a*8+7]=t.opacity??1,kn(r,a*u*4,t,n),s.add(l+a)}a.push({first:l,count:t,width:u,height:t,data:r,instances:i}),o-=r.byteLength+i.byteLength}l+=Math.max(1,t)}}return a}function On(e,t){return!!e&&!e.repeat&&e.interpolate!==!1&&!e.monochrome&&e.height===1&&Number.isInteger(e.width)&&e.width>0&&e.width<=t&&e.data instanceof Uint8Array&&e.data.length>=e.width*4&&!T(e.data,e.width,e.height)&&e.matrix instanceof Float32Array&&e.matrix.length>=6&&e.matrix.subarray(0,6).every(Number.isFinite)&&Number.isFinite(e.opacity??1)&&(e.opacity??1)>=0&&(e.opacity??1)<=1}function kn(e,t,n,r){let i=n.width;for(let r=0;r<i;r++){let i=r*4,a=n.data[i+3];for(let r=0;r<3;r++)e[t+i+r]=Math.round(n.data[i+r]*a/255);e[t+i+3]=a}for(;i>1;){let n=Math.floor(i/2),a=t+i*4,o=r===`linear`?n*2:2;for(let s=0;s<n;s++){let c=r===`linear`?(s*2+1)*i-n:s*4+1,l=Math.floor(c/o),u=c-l*o;for(let n=0;n<4;n++)e[a+s*4+n]=Math.floor((e[t+l*4+n]*(o-u)+e[t+(l+1)*4+n]*u+o/2)/o)}t=a,i=n}}let An=null,jn=!1,Mn=Promise.resolve(),Nn;function Pn(e,t){let n=Mn.then(async()=>{if(Nn!==void 0&&clearTimeout(Nn),!jn&&typeof Worker<`u`&&e.width*e.height>=65536)try{An??=new Worker(new URL(
/* @vite-ignore */
new URL(`rasterPreparationWorker-CAxzkRGV.js`,import.meta.url).href,``+import.meta.url),{type:`module`});let n=An,r=e.monochrome,i=r?{data:r.data,colors:r.colors,...t.width===e.width&&t.height===e.height&&r.symbols?{symbols:r.symbols}:{}}:void 0,a={width:e.width,height:e.height,data:r?/* @__PURE__ */ new Uint8Array:e.data,monochrome:i};return await new Promise((e,r)=>{let i=setTimeout(()=>r(/* @__PURE__ */ Error(`Raster preparation worker timed out.`)),3e4);n.onmessage=t=>{clearTimeout(i),t.data.error?r(Error(t.data.error)):e(t.data.result)},n.onerror=e=>{clearTimeout(i),r(Error(e.message||`Raster preparation worker failed.`))},n.onmessageerror=()=>{clearTimeout(i),r(/* @__PURE__ */ Error(`Raster preparation worker returned invalid data.`))};try{n.postMessage({source:a,plan:t})}catch(e){clearTimeout(i),r(e)}})}catch(e){An?.terminate(),An=null,jn=!0,console.warn(`[HEPR] Raster preparation worker unavailable; preparing pixels cooperatively.`,e)}finally{Nn=setTimeout(()=>{An?.terminate(),An=null},3e4),Nn.unref?.()}return await new Promise(e=>setTimeout(e,0)),Ut(e,t)});return Mn=n.then(()=>{},()=>{}),n}function Fn(e){let t=e.next();for(;!t.done;)t=e.next(void 0);return t.value}async function In(e,t){let n=e.next();for(;!n.done;){let r=n.value,i=performance.now();try{let a=r.cached?void 0:await Pn(r.source,r.plan);r.cached||t(`pageSwap.rasterPreparation`,performance.now()-i),await new Promise(e=>setTimeout(e,0)),n=e.next(a)}catch(t){n=e.throw(t)}}return n.value}var Ln=class{identities=/* @__PURE__ */ new WeakMap;repeatIdentities=/* @__PURE__ */ new WeakMap;keys=/* @__PURE__ */ new WeakMap;entries=/* @__PURE__ */ new Map;nextIdentity=0;bytes=0;release;constructor(e){this.release=e}key(e,t,n){let r=e.monochrome?.data??e.data,i=this.identities.get(r);i===void 0&&this.identities.set(r,i=++this.nextIdentity);let a=0;return e.repeat&&(a=this.repeatIdentities.get(e.repeat)??++this.nextIdentity,this.repeatIdentities.set(e.repeat,a)),`${i}:${e.width}:${e.height}:${t.width}:${t.height}:${t.tiles.map(e=>`${e.x},${e.y},${e.width},${e.height}`).join(`;`)}:${n??``}:${e.interpolate===!1?`nearest`:`smooth`}:${e.opacity??1}:${e.matrix?Array.from(e.matrix).join(`,`):``}:${e.pageIndex??0}:${e.paintOrder??0}:${e.monochrome?Array.from(e.monochrome.colors).join(`,`):``}:${a}`}remember(e,t,n,r){return this.keys.set(e,this.key(t,n,r)),e}take(e,t,n){let r=this.key(e,t,n),i=this.entries.get(r);return i?(this.entries.delete(r),this.bytes-=i.bytes,i.resource):null}has(e,t,n){return this.entries.has(this.key(e,t,n))}park(e,t){let n=this.keys.get(e);if(!n){this.release(e);return}let r=this.entries.get(n);r&&(this.bytes-=r.bytes,this.release(r.resource),this.entries.delete(n)),this.entries.set(n,{resource:e,bytes:t}),this.bytes+=t}trim(e){for(let[t,n]of this.entries){if(this.bytes<=Math.max(0,e))break;this.entries.delete(t),this.bytes-=n.bytes,this.release(n.resource)}}clear(){for(let e of this.entries.values())this.release(e.resource);this.entries.clear(),this.bytes=0}};function Rn(e){return e.replace(`uniform vec4 uRasterMatrixABCD;`,`layout(location = 1) in vec4 aRasterRepeatABCD;`).replace(`uniform vec2 uRasterMatrixEF;`,`layout(location = 2) in vec2 aRasterRepeatEF;`).replace(/\buRasterMatrixABCD\b/g,`aRasterRepeatABCD`).replace(/\buRasterMatrixEF\b/g,`aRasterRepeatEF`)}function zn(e,t=()=>!0){let n=/* @__PURE__ */ new Map;if(!e.drawRuns)return n;let r=/* @__PURE__ */ new WeakMap,i=[],a,o,s,c=()=>{if(i.length>1){let e=[...Un(i,0),...Un(i,1)],t=e.map(e=>[Math.min(e.left.order,e.right.order),Math.max(e.left.order,e.right.order)]).sort((e,t)=>e[0]-t[0]||e[1]-t[1]),a=[],o=0;for(let[e,n]of t){for(let t=Math.max(e,o);t<=n;t++)Hn(i[t],r)||a.push(t);o=Math.max(o,n+1)}for(let t of e){let e=Math.min(t.left.order,t.right.order),r=Math.max(t.left.order,t.right.order),i=0,o=a.length;for(;i<o;){let t=Math.floor((i+o)/2);a[t]<e?i=t+1:o=t}(i===a.length||a[i]>r)&&Wn(t,n)}}i=[],a=void 0,o=void 0,s=void 0},l=(n,r)=>{if(!n||n.kind!==`raster`||n.clipIndex!==void 0||n.blendMode||!Number.isSafeInteger(n.first)||!Number.isSafeInteger(n.count)||n.first<0||n.count<1||n.first+n.count>e.rasterLayers.length){c();return}a&&(a.optionalContent!==n.optionalContent||o!==r||!Bn(a,n))&&c();for(let l=n.first;l<n.first+n.count;l++){let u=e.rasterLayers[l],d=t(l)?Vn(u,l):null;if(!d){c();continue}s!==void 0&&s!==u.pageIndex&&c(),d.order=i.length,i.push(d),a=n,o=r,s=u.pageIndex}};if(e.paintGraph){let t=[{nodes:e.paintGraph.roots,next:0}];for(;t.length;){let n=t[t.length-1];if(n.next===n.nodes.length){c(),t.pop();continue}let r=n.nodes[n.next++];r.kind===`draw`?l(e.drawRuns[r.runIndex],r.optionalContent):(c(),r.kind===`group`&&r.alpha===1&&r.blendMode===`Normal`&&!r.knockout&&!r.softMask&&t.push({nodes:r.children,next:0}))}}else{for(let t of e.drawRuns)l(t);c()}return n}function Bn(e,t){let n=e.pdfRepresentation,r=t.pdfRepresentation;return n===r||!!n&&!!r&&n.pageIndex===r.pageIndex&&n.detail===r.detail}function Vn(e,t){if(!e||e.repeat||e.monochrome||e.pageDemandSlot||(e.opacity??1)!==1||!Number.isSafeInteger(e.width)||!Number.isSafeInteger(e.height)||e.width<1||e.height<1||!(e.matrix instanceof Float32Array)||e.matrix.length!==6||!e.matrix.every(Number.isFinite))return null;let[n,r,i,a,o,s]=e.matrix,c=r===0&&i===0&&n!==0&&a!==0;if(!c&&(n!==0||a!==0||r===0||i===0))return null;let l=e.width*e.height*4;if(!Number.isSafeInteger(l))return null;let u=Object.getOwnPropertyDescriptor(e,`data`)?.value;if(!(u instanceof Uint8Array)||u.length<l)return null;let d=Math.fround((c?n:i)+o),f=Math.fround((c?a:r)+s),p=[Math.min(o,d),Math.min(s,f),Math.max(o,d),Math.max(s,f)],m=c?[Math.abs(n)/e.width,Math.abs(a)/e.height]:[Math.abs(i)/e.height,Math.abs(r)/e.width];return p.every(Number.isFinite)&&p[0]<p[2]&&p[1]<p[3]&&m.every(e=>e>0&&Number.isFinite(e))?{index:t,order:0,bounds:p,pitch:m,pixels:u,count:l}:null}function Hn(e,t){let n=t.get(e.pixels);n||(n=/* @__PURE__ */ new Map,t.set(e.pixels,n));let r=n.get(e.count);if(r===void 0){r=!0;for(let t=3;t<e.count;t+=4)if(e.pixels[t]!==255){r=!1;break}n.set(e.count,r)}return r}function Un(e,t){let n=[],r=1-t,i=/* @__PURE__ */ new Map;for(let t of e){let e=t.bounds[r],n=t.bounds[r+2],a=i.get(e);a||(a=/* @__PURE__ */ new Map,i.set(e,a));let o=a.get(n);o||(o=[],a.set(n,o)),o.push(t)}for(let e of i.values())for(let r of e.values()){r.sort((e,n)=>e.bounds[t]-n.bounds[t]||e.bounds[t+2]-n.bounds[t+2]||e.index-n.index);let e=1/0;for(let n of r)e=Math.min(e,n.bounds[t+2]-n.bounds[t]);let i=r[0].bounds[t+2];for(let a=1;a<r.length;a++){let o=r[a-1],s=r[a],c=s.bounds[t]-o.bounds[t+2],l=o.bounds[t+2]===i;i=Math.max(i,s.bounds[t+2]),!(!l||!(c>0)||c>Math.min(o.pitch[t],s.pitch[t]))&&n.push({left:o,right:s,axis:t,gap:c,limit:e})}}return n}function Wn({left:e,right:t,axis:n,gap:r,limit:i},a){let o=e=>{let t=a.get(e.index);return t||(t={bounds:Float32Array.from(e.bounds),gaps:/* @__PURE__ */ new Float32Array(4),maxFootprint:/* @__PURE__ */ new Float32Array(2)},a.set(e.index,t)),t},s=Math.fround(e.bounds[n+2]+r*.5),c=Math.fround(r),l=o(e),u=o(t);l.bounds[n+2]=u.bounds[n]=s,l.gaps[n+2]=u.gaps[n]=c,l.maxFootprint[n]=u.maxFootprint[n]=i}const Gn=`
float heprRasterGapCoverage(float point, float footprint, float lo, float hi) {
  float width = max(footprint, 1e-8);
  return clamp((min(point + width * 0.5, hi) - max(point - width * 0.5, lo)) / width, 0.0, 1.0);
}

float heprRasterTileSeamCoverage(vec2 point, vec2 footprint, vec4 bounds, vec4 gaps, vec2 maxFootprint) {
  float x = 1.0 - heprRasterGapCoverage(point.x, footprint.x, bounds.x - gaps.x, bounds.x)
    - heprRasterGapCoverage(point.x, footprint.x, bounds.z, bounds.z + gaps.z);
  float y = 1.0 - heprRasterGapCoverage(point.y, footprint.y, bounds.y - gaps.y, bounds.y)
    - heprRasterGapCoverage(point.y, footprint.y, bounds.w, bounds.w + gaps.w);
  
  
  
  if (gaps.x + gaps.z > 0.0 && footprint.x > maxFootprint.x) {
    x = point.x >= bounds.x && point.x < bounds.z ? 1.0 : 0.0;
  }
  if (gaps.y + gaps.w > 0.0 && footprint.y > maxFootprint.y) {
    y = point.y >= bounds.y && point.y < bounds.w ? 1.0 : 0.0;
  }
  return clamp(x, 0.0, 1.0) * clamp(y, 0.0, 1.0);
}
`,Kn=`
vec4 heprRasterOriginalBounds(vec4 matrixABCD, vec2 matrixEF) {
  vec2 other = matrixEF + matrixABCD.xy + matrixABCD.zw;
  return vec4(min(matrixEF, other), max(matrixEF, other));
}

vec4 heprRasterTileSeamPack(vec2 uv, vec4 matrixABCD, vec2 matrixEF, vec4 bounds) {
  
  
  vec2 offset = uv - vec2(0.5);
  bvec2 farCorner = bvec2(dot(matrixABCD.xz, offset) > 0.0, dot(matrixABCD.yw, offset) > 0.0);
  vec2 world = mix(bounds.xy, bounds.zw, farCorner);
  vec4 original = heprRasterOriginalBounds(matrixABCD, matrixEF);
  vec2 delta = (world - mix(original.xy, original.zw, farCorner)) / (original.zw - original.xy);
  vec2 sourceUv = uv;
  if (matrixABCD.x != 0.0) sourceUv += vec2(sign(matrixABCD.x) * delta.x, sign(matrixABCD.w) * delta.y);
  else sourceUv += vec2(sign(matrixABCD.y) * delta.y, sign(matrixABCD.z) * delta.x);
  
  
  return vec4(world, sourceUv);
}
`;function qn(e){return e.replace(`out vec2 vWorld;`,`out vec2 vWorld;
uniform vec4 uRasterSeamBounds;
uniform vec4 uRasterSeamGaps;
flat out vec4 vRasterSeamOriginalBounds;
${Kn}`).replace(`  if (uUseLocalToClip >= 0.5) {`,`  vRasterSeamOriginalBounds = heprRasterOriginalBounds(uRasterMatrixABCD, uRasterMatrixEF);
  if (any(greaterThan(uRasterSeamGaps, vec4(0.0)))) {
    vec4 packed = heprRasterTileSeamPack(tileCorner, uRasterMatrixABCD, uRasterMatrixEF, uRasterSeamBounds);
    world = packed.xy; uv = packed.zw;
  }
  if (uUseLocalToClip >= 0.5) {`)}function Jn(e){return e.replace(`in vec2 vWorld;`,`in vec2 vWorld;
uniform vec4 uRasterSeamGaps;
uniform vec2 uRasterSeamMaxFootprint;
flat in vec4 vRasterSeamOriginalBounds;
${Gn}`).replace(`  vec4 color = texture(uRasterTex, vUv) * uRasterOpacity;`,`  vec2 seamFootprint = abs(dFdx(vWorld)) + abs(dFdy(vWorld));
  vec4 color = texture(uRasterTex, vUv) * uRasterOpacity;
  if (any(greaterThan(uRasterSeamGaps, vec4(0.0)))) {
    color *= heprRasterTileSeamCoverage(vWorld, seamFootprint, vRasterSeamOriginalBounds, uRasterSeamGaps, uRasterSeamMaxFootprint);
  }`)}var Yn=class{tiers=/* @__PURE__ */ new WeakMap;retainedTiers=/* @__PURE__ */ new Map;failures=/* @__PURE__ */ new Map;sources;cache=/* @__PURE__ */ new Map;singleChannelMonochrome;constructor(e=!0){this.singleChannelMonochrome=e}inheritTiers(e,t,n){let r=e=>`${e.pageIndex??0}:${e.width}:${e.height}:${Array.from(e.matrix).join(`,`)}`,i=t.length?/* @__PURE__ */ new Map:e.retainedTiers;for(let n of t){let t=e.tiers.get(n);t!==void 0&&i.set(r(n),t)}for(let e of n){let t=i.get(r(e));t!==void 0&&this.tiers.set(e,t)}this.retainedTiers=i}plan(e,t,n,r,i){let a=e.map((e,t)=>{let r=Math.max(0,Math.ceil(Math.log2(Math.max(e.width,e.height)/128))),a=n?Xn(e,t,n):null,o=r;if(a!==null){let t=Math.min(1,Math.max(1/Math.max(e.width,e.height),a*1.25));o=Math.max(0,Math.floor(Math.log2(1/t)));let n=this.tiers.get(e);if(n!==void 0){let e=2**-n;e>=t&&e<=t*2.5&&(o=n)}}this.tiers.set(e,o);let s=e.gpuPreparation??(!e.monochrome&&e.compressionEligible&&e.gpuCompression?.format===i?e.gpuCompression:void 0);return{width:e.width,height:e.height,displayWidth:Math.min(e.width,Math.max(1,Math.floor(e.width/2**o),s?.plan.width??0)),displayHeight:Math.min(e.height,Math.max(1,Math.floor(e.height/2**o),s?.plan.height??0)),...this.singleChannelMonochrome&&e.monochrome?{monochrome:e.monochrome,reducedMonochrome:!0}:{},compressionEligible:e.compressionEligible,preferCompression:e.preferCompression,allocationCopies:e.allocationCopies}});this.sources!==e&&(this.sources=e,this.cache.clear());let o=`${t}:${r}:${Dt().bytes}:${i}:`+a.map(e=>`${e.displayWidth},${e.displayHeight}`).join(`;`),s=this.cache.get(o);if(s)return s;let c=Mt(a,t,r,i);return this.cache.size>=4&&this.cache.clear(),this.cache.set(o,c),c}nextChange(e,t,n){let r=-1;for(let i=0;i<t.length;i++){let a=n.plans[i],o=t[i],s=n.compressionFormats[i];if(!a||!o||this.failures.get(i)===this.key(i,a,s)||ie(o.rasterPlan,a)&&(o.compressionFormat??null)===s)continue;let c=e[i];if(At({width:c.width,height:c.height,...this.singleChannelMonochrome&&c.monochrome?{monochrome:c.monochrome,reducedMonochrome:!0}:{}},a,s)<o.estimatedBytes)return i;r<0&&(r=i)}return r}failed(e,t){this.failures.set(e,this.key(e,t.plans[e],t.compressionFormats[e]))}invalidate(){this.cache.clear(),this.failures.clear()}key(e,t,n){return`${e}:${t.width}:${t.height}:${n}`}};function Xn(e,t,n){if(!(n.width>0&&n.height>0&&n.zoom>0))return null;let r=n.projection?n.projection(t):n.localToClip;if(r===null)return null;let i=e.matrix,a=[[0,0],[1,0],[0,1],[1,1]].map(([e,t])=>{let a=i[0]*e+i[2]*t+i[4],o=i[1]*e+i[3]*t+i[5];if(r){let e=r[3]*a+r[7]*o+r[15];return e>1e-8?[(r[0]*a+r[4]*o+r[12])/e*n.width/2+n.width/2,(r[1]*a+r[5]*o+r[13])/e*n.height/2+n.height/2]:null}return[(a-n.cameraCenterX)*n.zoom+n.width/2,(o-n.cameraCenterY)*n.zoom+n.height/2]});if(a.some(e=>e===null))return 1;let o=a,s=o.map(e=>e[0]),c=o.map(e=>e[1]);if(Math.max(...s)<-64||Math.min(...s)>n.width+64||Math.max(...c)<-64||Math.min(...c)>n.height+64)return null;let l=(e,t)=>Math.hypot(o[e][0]-o[t][0],o[e][1]-o[t][1]);return Math.max(Math.max(l(0,1),l(2,3))/e.width,Math.max(l(0,2),l(1,3))/e.height)}[`
fn heprCompactWord(image: texture_2d<f32>, offset: u32) -> u32 {
  let width = textureDimensions(image).x;
  let bytes = vec4u(round(textureLoad(image, vec2i(i32(offset % width), i32(offset / width)), 0) * 255.0));
  return bytes.r | (bytes.g << 8u) | (bytes.b << 16u) | (bytes.a << 24u);
}`,`
fn heprCompactBlock(image: texture_2d<f32>, entry: u32, pixel: vec2u, bits: u32) -> f32 {
  if ((entry & 0x80000000u) != 0u) { return f32(entry & 255u); }
  let bit = ((pixel.y & 31u) * 32u + (pixel.x & 31u)) * bits;
  return f32((heprCompactWord(image, entry + bit / 32u) >> (bit & 31u)) & ((1u << bits) - 1u));
}`,`
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
}`,`
fn heprCompactBilinear(image: texture_2d<f32>, size: vec2i, level: u32, uv: vec2f) -> f32 {
  let position = uv * vec2f(size) - vec2f(0.5);
  let pixel = vec2i(floor(position)); let weight = fract(position);
  return mix(mix(heprCompactTexel(image, size, level, pixel), heprCompactTexel(image, size, level, pixel + vec2i(1,0)), weight.x),
    mix(heprCompactTexel(image, size, level, pixel + vec2i(0,1)), heprCompactTexel(image, size, level, pixel + vec2i(1,1)), weight.x), weight.y);
}`,`
fn heprCompactSample(image: texture_2d<f32>, baseSize: vec2i, uv: vec2f, lod: f32) -> f32 {
  let bounded = clamp(lod, 0.0, f32(heprCompactWord(image, 2u) - 1u));
  let level = u32(floor(bounded)); var size = baseSize;
  for (var i = 0u; i < 32u; i++) { if (i >= level) { break; } size = max(size / 2, vec2i(1)); }
  let first = heprCompactBilinear(image, size, level, uv);
  let next = min(level + 1u, heprCompactWord(image, 2u) - 1u);
  return mix(first, heprCompactBilinear(image, max(size / 2, vec2i(1)), next, uv), fract(bounded));
}`].join(`
`);function Zn(e){return e.replace(`precision highp float;`,`precision highp float;
precision highp int;`).replace(`uniform sampler2D uRasterTex;`,`uniform sampler2D uRasterTex;
uniform sampler2D uRasterMonoMips;
uniform float uRasterMonochrome;
uniform float uRasterOpaque;
uniform vec2 uRasterMonoSize;
uniform vec4 uRasterMonoColor0;
uniform vec4 uRasterMonoColor1;

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
}

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
}`).replace(`texture(uRasterTex, vUv)`,`heprRasterColor(vUv, dFdx(vUv), dFdy(vUv))`)}function Qn(){try{return!globalThis.matchMedia?.(`(prefers-reduced-motion: reduce)`).matches}catch{return!0}}function $n(e=performance.now()){return Qn()?e/1e3%2.4:1.2}function er(e,t){if(!e.pendingPagePreviews||!(t.width>0&&t.height>0&&t.zoom>0))return!1;let n=e.pageRects;for(let r=0;r<e.pendingPagePreviews.length;r++){if(!e.pendingPagePreviews[r])continue;let i=r*4,a=t.projection?t.projection(r):t.localToClip;if(a===null)continue;if(!a){let e=t.width/t.zoom/2,r=t.height/t.zoom/2;if(Math.max(n[i],n[i+2])>=t.cameraCenterX-e&&Math.min(n[i],n[i+2])<=t.cameraCenterX+e&&Math.max(n[i+1],n[i+3])>=t.cameraCenterY-r&&Math.min(n[i+1],n[i+3])<=t.cameraCenterY+r)return!0;continue}let o=1/0,s=1/0,c=1/0,l=-1/0,u=-1/0,d=-1/0,f=0;for(let[e,t]of[[n[i],n[i+1]],[n[i+2],n[i+1]],[n[i],n[i+3]],[n[i+2],n[i+3]]]){let n=a[3]*e+a[7]*t+a[15];if(!(n>1e-8))continue;f++;let r=(a[0]*e+a[4]*t+a[12])/n,i=(a[1]*e+a[5]*t+a[13])/n,p=(a[2]*e+a[6]*t+a[14])/n;o=Math.min(o,r),l=Math.max(l,r),s=Math.min(s,i),u=Math.max(u,i),c=Math.min(c,p),d=Math.max(d,p)}if(f&&(f<4||l>=-1&&o<=1&&u>=-1&&s<=1&&d>=(t.clipDepth??-1)&&c<=1))return!0}return!1}function tr(e){return e.replace(`layout(location = 1) in vec4 aPageRect;`,`layout(location = 1) in vec4 aPageRect;
layout(location = 4) in float aPageLoading;
flat out float vPageLoading;`).replace(`vec2 world = aPageRect.xy + aPageRect.zw * localTopDown;`,`vec2 world = aPageRect.xy + aPageRect.zw * localTopDown;
  vPageLoading = aPageLoading;`)}function nr(e){return e.replace(`void main() {`,`uniform float uPagePlaceholderTime;
flat in float vPageLoading;

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
}
void main() {`).replace(`if (color.a <= 0.001)`,`color = heprPagePlaceholder(color,vUv,vPageLoading,uPagePlaceholderTime);
  if (color.a <= 0.001)`)}const rr=`#version 300 es
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

${gn}

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
`,ir=1024;function ar(e,t,n=/* @__PURE__ */ new Set){if(!e.drawRuns||e.retainedPages?.length||!Number.isFinite(t))return[];let r=Math.min(2048,Math.floor(t));if(r<2)return[];let i=[],a=16777216,o=16384;for(let t=0;t<e.rasterLayers.length&&o>=4;){let s=[],c=0,l=0,u=0,d=0,f=0;for(;s.length<Math.min(512,o)&&t+s.length<e.rasterLayers.length;){let i=t+s.length,o=e.rasterLayers[i];if(n.has(i)||!or(o,r))break;let p=sr(o.width,o.height),m=c,h=l,g=u;m+p>r&&(m=0,h+=u,g=0);let _=Math.max(d,m+p),v=Math.max(f,h+o.height);if(v>r||_*v*4+(s.length+1)*48>a)break;s.push({x:m,y:h}),c=m+p,l=h,u=Math.max(g,o.height),d=_,f=v}if(s.length>=4){let n=new Uint8Array(d*f*4),r=new Float32Array(s.length*12);for(let i=0;i<s.length;i++){let a=e.rasterLayers[t+i],o=s[i];r.set(a.matrix.subarray(0,6),i*12),r[i*12+6]=a.opacity??1,r.set([o.x,o.y,a.width,a.height],i*12+8),cr(n,d,o.x,o.y,a)}i.push({first:t,count:s.length,width:d,height:f,data:n,instances:r}),a-=n.byteLength+r.byteLength,o-=s.length}t+=Math.max(1,s.length)}return i}function or(e,t){return!!e&&!e.repeat&&e.interpolate!==!1&&!e.monochrome&&Number.isInteger(e.width)&&Number.isInteger(e.height)&&e.width>0&&e.height>0&&e.width<=ir&&e.height<=ir&&e.height<=t&&sr(e.width,e.height)<=t&&e.data instanceof Uint8Array&&e.data.length>=e.width*e.height*4&&!T(e.data,e.width,e.height)&&e.matrix instanceof Float32Array&&e.matrix.length>=6&&e.matrix.subarray(0,6).every(Number.isFinite)&&Number.isFinite(e.opacity??1)&&(e.opacity??1)>=0&&(e.opacity??1)<=1}function sr(e,t){let n=e;for(;e>1||t>1;)e=Math.max(1,Math.floor(e/2)),t=Math.max(1,Math.floor(t/2)),n+=e;return n}function cr(e,t,n,r,i){let a=i.width,o=i.height,s=new Uint8Array(a*o*4);for(let e=0;e<s.length;e+=4){let t=i.data[e+3]/255;for(let n=0;n<3;n++)s[e+n]=Math.round(i.data[e+n]*t);s[e+3]=i.data[e+3]}for(;;){for(let i=0;i<o;i++)e.set(s.subarray(i*a*4,(i+1)*a*4),((r+i)*t+n)*4);if(a===1&&o===1)break;let i=Math.max(1,Math.floor(a/2)),c=Math.max(1,Math.floor(o/2)),l=new Uint8Array(i*c*4);for(let e=0;e<c;e++){let t=(e*2+1)*o-c,n=c*2,r=Math.floor(t/n),u=t-r*n,d=Math.min(r+1,o-1);for(let t=0;t<i;t++){let o=(t*2+1)*a-i,c=i*2,f=Math.floor(o/c),p=o-f*c,m=Math.min(f+1,a-1);for(let o=0;o<4;o++){let h=s[(r*a+f)*4+o]*(c-p)+s[(r*a+m)*4+o]*p,g=s[(d*a+f)*4+o]*(c-p)+s[(d*a+m)*4+o]*p;l[(e*i+t)*4+o]=Math.floor((h*(n-u)+g*u+c*n/2)/(c*n))}}}n+=a,a=i,o=c,s=l}}function lr(e,t){let n=()=>Float32Array.of(0,0,0,0,0,1,1);if(!t)return n();if(t[0]>t[2]||t[1]>t[3])return Float32Array.of(0,0,0,1,1,0,0);let r=e[0],i=e[1],a=e[2],o=e[3],s=e[4],c=e[5],l=r*o-i*a;if(!Number.isFinite(l)||Math.abs(l)<=1e-8*Math.max(Math.abs(r*o)+Math.abs(i*a),1e-30))return n();let u=o/l,d=-a/l,f=-i/l,p=r/l,m=Math.abs(u)+Math.abs(d),h=Math.abs(f)+Math.abs(p),g=t[0]-s,_=t[1]-c,v=t[2]-s,y=t[3]-c,b=Math.max(1,Math.abs(r),Math.abs(i),Math.abs(a),Math.abs(o),Math.abs(s),Math.abs(c),Math.abs(t[0]),Math.abs(t[1]),Math.abs(t[2]),Math.abs(t[3]))*2**-20,x=Float32Array.of(m,h,0,Math.min(u*g,u*v)+Math.min(d*_,d*y)-b*m,Math.min(f*g,f*v)+Math.min(p*_,p*y)-b*h,Math.max(u*g,u*v)+Math.max(d*_,d*y)+b*m,Math.max(f*g,f*v)+Math.max(p*_,p*y)+b*h);return x.every(Number.isFinite)?x:n()}const ur=`#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uRasterAtlasTex;
uniform vec2 uRasterAtlasSize;
uniform float uPdfShapeOnly;
in vec2 vUv;
in vec2 vWorld;
flat in vec4 vAtlasRect;
flat in float vOpacity;
out vec4 outColor;

${gn}

vec4 sampleImageLevel(float level) {
  vec2 size = vAtlasRect.zw;
  float offset = 0.0;
  for (int step = 0; step < 10; step++) {
    if (float(step) >= level) break;
    offset += size.x;
    size = max(vec2(1.0), floor(size * 0.5));
  }
  
  
  vec2 pixel = vAtlasRect.xy + vec2(offset, 0.0) + clamp(vUv * size, vec2(0.5), size - 0.5);
  return textureLod(uRasterAtlasTex, pixel / uRasterAtlasSize, 0.0);
}

void main() {
  float clipAAWidth = max(max(length(vec2(dFdx(vWorld.x), dFdy(vWorld.x))),
    length(vec2(dFdx(vWorld.y), dFdy(vWorld.y)))), 1e-4);
  vec2 sourcePixels = vUv * vAtlasRect.zw;
  float footprint = max(length(dFdx(sourcePixels)), length(dFdy(sourcePixels)));
  float maxLevel = floor(log2(max(vAtlasRect.z, vAtlasRect.w)));
  float lod = clamp(log2(max(footprint, 1.0)), 0.0, maxLevel);
  vec4 color = mix(sampleImageLevel(floor(lod)), sampleImageLevel(ceil(lod)), fract(lod)) * mix(vOpacity, 1.0, uPdfShapeOnly);
  if (color.a <= 0.001) discard;
  outColor = color * heprVectorClipAA(vWorld, clipAAWidth);
}
`,dr=gn.replace(`uniform float uVectorClipIndex;`,``).replace(/uVectorClipIndex/g,`vRasterClip`),fr=`#version 300 es
precision highp float;

layout(location = 0) in vec4 aRasterMatrixABCD;
layout(location = 1) in vec4 aRasterEFOpacityClip;
layout(location = 2) in vec3 aTextureSlotUvMargin;
layout(location = 3) in vec4 aRasterUvBounds;
layout(location = 4) in vec4 aRasterSeamBounds;
layout(location = 5) in vec4 aRasterSeamGaps;
layout(location = 6) in vec2 aRasterSeamMaxFootprint;
uniform vec2 uViewport;
uniform vec2 uCameraCenter;
uniform float uZoom;
uniform float uUseLocalToClip;
uniform mat4 uLocalToClip;
out vec2 vUv;
out vec2 vWorld;
flat out float vOpacity;
flat out float vRasterClip;
flat out float vTextureSlot;
flat out vec4 vRasterSeamOriginalBounds;
flat out vec4 vRasterSeamGaps;
flat out vec2 vRasterSeamMaxFootprint;


vec4 heprRasterClipUvBounds(vec4 bounds, vec2 uvMargin, float worldMargin) {
  if (bounds.x > bounds.z || bounds.y > bounds.w) return bounds;
  float padU = uvMargin.x * worldMargin;
  float padV = uvMargin.y * worldMargin;
  return vec4(max(0.0, bounds.x - padU), max(0.0, bounds.y - padV),
    min(1.0, bounds.z + padU), min(1.0, bounds.w + padV));
}

${Kn}

void main() {
  vec2 uv = vec2(float(gl_VertexID & 1), float(1 - (gl_VertexID >> 1)));
  vOpacity = aRasterEFOpacityClip.z;
  vRasterClip = aRasterEFOpacityClip.w; vTextureSlot = aTextureSlotUvMargin.x;
  vRasterSeamGaps = aRasterSeamGaps;
  vRasterSeamMaxFootprint = aRasterSeamMaxFootprint;
  vRasterSeamOriginalBounds = heprRasterOriginalBounds(aRasterMatrixABCD, aRasterEFOpacityClip.xy);
  if (uUseLocalToClip < 0.5) {
    vec4 bounds = heprRasterClipUvBounds(aRasterUvBounds, aTextureSlotUvMargin.yz,
      max(1.0 / max(uZoom, 1e-6), 1e-4));
    if (bounds.x > bounds.z || bounds.y > bounds.w) {
      vUv = vec2(0.0); vWorld = vec2(0.0);
      gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
      return;
    }
    uv = mix(bounds.xy, bounds.zw, uv);
  }
  vec2 world = vec2(
    aRasterMatrixABCD.x * uv.x + aRasterMatrixABCD.z * uv.y + aRasterEFOpacityClip.x,
    aRasterMatrixABCD.y * uv.x + aRasterMatrixABCD.w * uv.y + aRasterEFOpacityClip.y
  );
  if (any(greaterThan(aRasterSeamGaps, vec4(0.0)))) {
    vec4 packed = heprRasterTileSeamPack(uv, aRasterMatrixABCD, aRasterEFOpacityClip.xy, aRasterSeamBounds);
    world = packed.xy; uv = packed.zw;
  }
  if (uUseLocalToClip >= 0.5) gl_Position = uLocalToClip * vec4(world, 0.0, 1.0);
  else {
    vec2 screen = (world - uCameraCenter) * uZoom + 0.5 * uViewport;
    gl_Position = vec4(screen / (0.5 * uViewport) - 1.0, 0.0, 1.0);
  }
  vUv = uv; vWorld = world;
}
`,pr=`#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uRasterBatchTex0;
uniform sampler2D uRasterBatchTex1;
uniform sampler2D uRasterBatchTex2;
uniform sampler2D uRasterBatchTex3;
uniform sampler2D uRasterBatchTex4;
uniform sampler2D uRasterBatchTex5;
uniform sampler2D uRasterBatchTex6;
uniform sampler2D uRasterBatchTex7;
uniform sampler2D uRasterBatchTex8;
uniform sampler2D uRasterBatchTex9;
uniform sampler2D uRasterBatchTex10;
uniform sampler2D uRasterBatchTex11;
uniform sampler2D uRasterBatchTex12;
uniform sampler2D uRasterBatchTex13;
uniform float uPdfShapeOnly;
in vec2 vUv;
in vec2 vWorld;
flat in float vOpacity;
flat in float vRasterClip;
flat in float vTextureSlot;
flat in vec4 vRasterSeamOriginalBounds;
flat in vec4 vRasterSeamGaps;
flat in vec2 vRasterSeamMaxFootprint;
out vec4 outColor;

${dr}
${Gn}



vec4 heprRasterBatchSample(float slot, vec2 uv, vec2 dx, vec2 dy) {
  vec4 color = vec4(0.0, 0.0, 0.0, 0.0);
  if (slot < 6.5) {
    if (slot < 2.5) {
      if (slot < 0.5) color = textureGrad(uRasterBatchTex0, uv, dx, dy);
      else if (slot < 1.5) color = textureGrad(uRasterBatchTex1, uv, dx, dy);
      else color = textureGrad(uRasterBatchTex2, uv, dx, dy);
    } else if (slot < 4.5) {
      if (slot < 3.5) color = textureGrad(uRasterBatchTex3, uv, dx, dy);
      else color = textureGrad(uRasterBatchTex4, uv, dx, dy);
    } else {
      if (slot < 5.5) color = textureGrad(uRasterBatchTex5, uv, dx, dy);
      else color = textureGrad(uRasterBatchTex6, uv, dx, dy);
    }
  } else {
    if (slot < 9.5) {
      if (slot < 7.5) color = textureGrad(uRasterBatchTex7, uv, dx, dy);
      else if (slot < 8.5) color = textureGrad(uRasterBatchTex8, uv, dx, dy);
      else color = textureGrad(uRasterBatchTex9, uv, dx, dy);
    } else if (slot < 11.5) {
      if (slot < 10.5) color = textureGrad(uRasterBatchTex10, uv, dx, dy);
      else color = textureGrad(uRasterBatchTex11, uv, dx, dy);
    } else {
      if (slot < 12.5) color = textureGrad(uRasterBatchTex12, uv, dx, dy);
      else color = textureGrad(uRasterBatchTex13, uv, dx, dy);
    }
  }
  return color;
}

void main() {
  float clipAAWidth = max(max(length(vec2(dFdx(vWorld.x), dFdy(vWorld.x))),
    length(vec2(dFdx(vWorld.y), dFdy(vWorld.y)))), 1e-4);
  
  
  vec2 dx = dFdx(vUv), dy = dFdy(vUv);
  vec2 seamFootprint = abs(dFdx(vWorld)) + abs(dFdy(vWorld));
  vec4 color = heprRasterBatchSample(vTextureSlot, vUv, dx, dy);
  color *= mix(vOpacity, 1.0, uPdfShapeOnly);
  if (any(greaterThan(vRasterSeamGaps, vec4(0.0)))) {
    color *= heprRasterTileSeamCoverage(vWorld, seamFootprint, vRasterSeamOriginalBounds, vRasterSeamGaps, vRasterSeamMaxFootprint);
  }
  if (color.a <= 0.001) discard;
  outColor = color * heprVectorClipAA(vWorld, clipAAWidth);
}
`,mr=`
${pn}
${l}
${p}
uniform sampler2D uGradientMetaTexA;
uniform sampler2D uGradientMetaTexB;
uniform sampler2D uGradientMetaTexC;
uniform sampler2D uGradientMetaTexD;
uniform sampler2D uGradientMetaTexE;
uniform sampler2D uGradientLutTex;
uniform ivec2 uGradientMetaTexSize;
uniform int uGradientCount;

ivec2 gradientCoord(int index) {
  return ivec2(index % uGradientMetaTexSize.x, index / uGradientMetaTexSize.x);
}

vec4 samplePdfGradient(int index, vec2 scenePoint) {
  if (index < 0 || index >= uGradientCount) {
    return vec4(0.0);
  }

  ivec2 coord = gradientCoord(index);
  vec4 metaA = texelFetch(uGradientMetaTexA, coord, 0);
  vec4 metaB = texelFetch(uGradientMetaTexB, coord, 0);
  vec4 metaC = texelFetch(uGradientMetaTexC, coord, 0);
  vec4 metaD = texelFetch(uGradientMetaTexD, coord, 0);
  vec4 metaE = texelFetch(uGradientMetaTexE, coord, 0);
  vec2 point = mat2(metaB.x, metaB.y, metaB.z, metaB.w) * scenePoint + metaC.xy;

  if (
    metaA.y >= 0.5 &&
    (point.x < metaE.x || point.y < metaE.y || point.x > metaE.z || point.y > metaE.w)
  ) {
    return vec4(0.0);
  }

  vec2 parameter = heprGradientParameter(metaA, metaC, metaD, point);
  if (parameter.y < 0.5) return heprGradientBackground(metaA.w);
  float t = parameter.x;

  float lutX = (clamp(t, 0.0, 1.0) * 1023.0 + 0.5) / 1024.0;
  float lutY = (float(index) + 0.5) / float(max(uGradientCount, 1));
  return texture(uGradientLutTex, vec2(lutX, lutY));
}
`,hr=`#version 300 es
precision highp float;



precision highp int;
precision highp sampler2D;

uniform sampler2D uPathMetaTexA;
uniform sampler2D uPathMetaTexB;
uniform sampler2D uPathMetaTexC;
uniform sampler2D uPaintMetaTex;
uniform ivec2 uPathMetaTexSize;


uniform sampler2D uSegmentTexA;
uniform ivec2 uSegmentTexSize;
uniform int uBandBase;


uniform int uCellHeaders;
uniform vec2 uViewport;
uniform vec2 uCameraCenter;
uniform float uZoom;
uniform float uUseLocalToClip;
uniform mat4 uLocalToClip;


uniform vec4 uClipBounds;

flat out int vSegmentStart;
flat out int vSegmentCount;

flat out vec4 vBands;

flat out vec4 vCells;
flat out vec2 vCellOrigin;
flat out int vSourceGradientIndex;
flat out int vMaskGradientIndex;
flat out vec3 vSolidColor;
flat out float vAlpha;
flat out float vFillRule;
flat out float vFillHasCompanionStroke;
out vec2 vLocal;

ivec2 coordFromIndex(int index, ivec2 sizeValue) {
  return ivec2(index % sizeValue.x, index / sizeValue.x);
}

vec2 cornerFromIndex(int index) {
  if (index == 0) return vec2(-1.0, -1.0);
  if (index == 1) return vec2(1.0, -1.0);
  if (index == 2) return vec2(-1.0, 1.0);
  return vec2(1.0, 1.0);
}

${un}

void main() {
  int pathIndex = gl_VertexID / 4;
  int cornerIndex = gl_VertexID - pathIndex * 4;
  ivec2 coord = coordFromIndex(pathIndex, uPathMetaTexSize);
  vec4 metaA = texelFetch(uPathMetaTexA, coord, 0);
  vec4 metaB = texelFetch(uPathMetaTexB, coord, 0);
  vec4 metaC = texelFetch(uPathMetaTexC, coord, 0);
  vec4 paintMeta = texelFetch(uPaintMetaTex, coord, 0);

  int segmentCount = int(metaA.y);
  float alpha = metaC.w;
  vec2 corner01 = cornerFromIndex(cornerIndex) * 0.5 + 0.5;
  
  vec2 margin = heprCoverageMargin(heprPathToPixel(mix(metaA.zw, metaB.xy, corner01),
    uUseLocalToClip, uLocalToClip, uZoom, uViewport));
  margin = heprBoundCoverageMargin(mix(max(metaA.zw, uClipBounds.xy), min(metaB.xy, uClipBounds.zw), corner01),
    margin, mat2(1.0), uUseLocalToClip, uLocalToClip, uViewport);
  
  
  
  
  
  vec2 low = max(metaA.zw, uClipBounds.xy) - margin;
  vec2 high = min(metaB.xy, uClipBounds.zw) + margin;
  if (segmentCount <= 0 || alpha <= 0.001 || any(greaterThan(low, high))) {
    gl_Position = vec4(-2.0, -2.0, 0.0, 1.0);
    vSegmentStart = 0;
    vSegmentCount = 0;
    vBands = vec4(0.0);
    vCells = vec4(0.0);
    vCellOrigin = vec2(0.0);
    vSourceGradientIndex = -1;
    vMaskGradientIndex = -1;
    vSolidColor = vec3(0.0);
    vAlpha = 0.0;
    vFillRule = 0.0;
    vFillHasCompanionStroke = 0.0;
    vLocal = vec2(0.0);
    return;
  }

  vec2 world = mix(low, high, corner01);
  if (uUseLocalToClip >= 0.5) {
    gl_Position = uLocalToClip * vec4(world, 0.0, 1.0);
  } else {
    vec2 screen = (world - uCameraCenter) * uZoom + 0.5 * uViewport;
    gl_Position = vec4((screen / (0.5 * uViewport)) - 1.0, 0.0, 1.0);
  }

  vSegmentStart = int(metaA.x);
  vSegmentCount = segmentCount;
  vBands = uBandBase < 0 ? vec4(0.0)
    : texelFetch(uSegmentTexA, coordFromIndex(uBandBase + pathIndex, uSegmentTexSize), 0);
  vCells = uCellHeaders <= 0 ? vec4(0.0)
    : texelFetch(uSegmentTexA, coordFromIndex(uCellHeaders - 1 + pathIndex, uSegmentTexSize), 0);
  vCellOrigin = metaA.zw;
  vSourceGradientIndex = int(round(paintMeta.x));
  vMaskGradientIndex = int(round(paintMeta.y));
  vSolidColor = vec3(metaB.z, metaB.w, metaC.z);
  vAlpha = alpha;
  vFillRule = metaC.x;
  vFillHasCompanionStroke = metaC.y;
  vLocal = world;
}
`,gr=`#version 300 es
precision highp float;



precision highp int;
precision highp sampler2D;

uniform sampler2D uSegmentTexA;
uniform sampler2D uSegmentTexB;
uniform ivec2 uSegmentTexSize;
uniform float uAAScreenPx;
uniform vec4 uVectorOverride;
uniform vec4 uPrimitiveOverride;
uniform int uBandEntries;
${mr}

flat in int vSegmentStart;
flat in int vSegmentCount;
flat in vec4 vBands;
flat in vec4 vCells;
flat in vec2 vCellOrigin;
flat in int vSourceGradientIndex;
flat in int vMaskGradientIndex;
flat in vec3 vSolidColor;
flat in float vAlpha;
flat in float vFillRule;
in vec2 vLocal;

out vec4 outColor;

ivec2 coordFromIndex(int index, ivec2 sizeValue) {
  return ivec2(index % sizeValue.x, index / sizeValue.x);
}

${ln}

vec4 heprCellFetchA(int index) {
  return texelFetch(uSegmentTexA, coordFromIndex(index, uSegmentTexSize), 0);
}

vec4 heprCellFetchB(int index) {
  return texelFetch(uSegmentTexB, coordFromIndex(index, uSegmentTexSize), 0);
}

${fn}

void main() {
  
  float dxLocal = length(vec2(dFdx(vLocal.x), dFdy(vLocal.x)));
  float dyLocal = length(vec2(dFdx(vLocal.y), dFdy(vLocal.y)));
  float aaWidth = max(max(dxLocal, dyLocal) * uAAScreenPx, 1e-4);
  vec2 footprint = max(vec2(dxLocal, dyLocal) * uAAScreenPx, vec2(1e-4));
  if (vSegmentCount <= 0 || vAlpha <= 0.001) discard;

  
  
  
  
  vec4 box = vec4(vLocal - 0.5 * footprint, 1.0 / footprint);
  float winding = 0.0;
  if (vCells.y > 0.0) {
    winding = heprCellWinding(vCells, vCellOrigin, box, footprint);
  } else {
    int bandCount = int(vBands.y);
    int firstBand = 0;
    int lastBand = 0;
    if (bandCount > 0) {
      float bandHeight = vBands.w;
      firstBand = clamp(int(floor((box.y - vBands.z) / bandHeight)), 0, bandCount - 1);
      lastBand = clamp(int(floor((box.y + footprint.y - vBands.z) / bandHeight)), 0, bandCount - 1);
    }

    for (int band = firstBand; band <= lastBand; band += 1) {
      int count = vSegmentCount;
      int entry = 0;
      if (bandCount > 0) {
        vec4 range = texelFetch(uSegmentTexA, coordFromIndex(int(vBands.x) + band, uSegmentTexSize), 0);
        entry = int(range.x);
        count = int(range.y);
      }
      vec2 rows = heprBandRows(vBands, band, bandCount, box);
      for (int primitiveIndex = 0; primitiveIndex < count; primitiveIndex += 1) {
        int segment = vSegmentStart + primitiveIndex;
        if (bandCount > 0) {
          int packedIndex = entry + primitiveIndex;
          vec4 packed = texelFetch(uSegmentTexA,
            coordFromIndex(uBandEntries + (packedIndex >> 2), uSegmentTexSize), 0);
          segment = int(packed[packedIndex & 3]);
        }
        ivec2 coord = coordFromIndex(segment, uSegmentTexSize);
        vec4 primitiveA = texelFetch(uSegmentTexA, coord, 0);
        vec4 primitiveB = texelFetch(uSegmentTexB, coord, 0);
        winding += heprSegmentCoverage(primitiveA.xy, primitiveA.zw, primitiveB.xy,
          primitiveB.z >= 0.5, box, rows.x, rows.y);
      }
    }
  }

  float coverage = heprFillCoverage(winding, vFillRule >= 0.5);

  vec4 source = vSourceGradientIndex >= 0
    ? samplePdfGradient(vSourceGradientIndex, vLocal)
    : vec4(vSolidColor, 1.0);
  float maskAlpha = vMaskGradientIndex >= 0 ? samplePdfGradient(vMaskGradientIndex, vLocal).a : 1.0;
  float alpha = coverage * vAlpha * source.a * maskAlpha;
  if (alpha <= 0.001) discard;
  vec3 baseColor = uPrimitiveOverride.a > 0.5 ? uPrimitiveOverride.rgb : source.rgb;
  vec3 color = mix(baseColor, uVectorOverride.rgb, clamp(uVectorOverride.a, 0.0, 1.0));
  outColor = vec4(color, clamp(alpha, 0.0, 1.0) * heprVectorClipAA(vLocal, aaWidth));
}
`,_r=`#version 300 es
precision highp float;
${sn}
precision highp sampler2D;

uniform float uStrokeCurveEnabled;
uniform float uAAScreenPx;
uniform vec4 uVectorOverride;
uniform vec4 uPrimitiveOverride;
${mr}

in vec2 vLocal;
flat in vec2 vP0;
flat in vec2 vP1;
flat in vec2 vP2;
flat in float vPrimitiveType;
flat in float vIsHairline;
flat in float vHalfWidth;
flat in vec3 vSolidColor;
flat in float vAlpha;
flat in vec4 vClipBounds;
flat in float vHasClipBounds;
flat in int vSourceGradientIndex;
flat in int vMaskGradientIndex;
out vec4 outColor;

float distanceToLine(vec2 point, vec2 start, vec2 end) {
  vec2 delta = end - start;
  float lengthSquared = dot(delta, delta);
  if (lengthSquared <= 1e-10) return length(point - start);
  float t = clamp(dot(point - start, delta) / lengthSquared, 0.0, 1.0);
  return length(point - (start + delta * t));
}

vec2 quadraticPoint(vec2 p0, vec2 p1, vec2 p2, float t) {
  float oneMinusT = 1.0 - t;
  return oneMinusT * oneMinusT * p0 + 2.0 * oneMinusT * t * p1 + t * t * p2;
}

float distanceToQuadratic(vec2 point, vec2 p0, vec2 p1, vec2 p2) {
  vec2 aa = p1 - p0;
  vec2 bb = p0 - 2.0 * p1 + p2;
  vec2 cc = aa * 2.0;
  vec2 dd = p0 - point;
  float bbLengthSquared = dot(bb, bb);
  if (bbLengthSquared <= 1e-12) return distanceToLine(point, p0, p2);
  float inverse = 1.0 / bbLengthSquared;
  float kx = inverse * dot(aa, bb);
  float ky = inverse * (2.0 * dot(aa, aa) + dot(dd, bb)) / 3.0;
  float kz = inverse * dot(dd, aa);
  float p = ky - kx * kx;
  float q = kx * (2.0 * kx * kx - 3.0 * ky) + kz;
  float h = q * q + 4.0 * p * p * p;
  float best = 1e20;
  if (h >= 0.0) {
    float hSqrt = sqrt(h);
    vec2 roots = (vec2(hSqrt, -hSqrt) - q) * 0.5;
    vec2 uv = sign(roots) * pow(abs(roots), vec2(1.0 / 3.0));
    float t = clamp(uv.x + uv.y - kx, 0.0, 1.0);
    vec2 delta = dd + (cc + bb * t) * t;
    best = dot(delta, delta);
  } else {
    float z = sqrt(-p);
    float angle = acos(clamp(q / (2.0 * p * z), -1.0, 1.0)) / 3.0;
    float cosine = cos(angle);
    float sine = sin(angle) * 1.732050808;
    vec3 roots = clamp(vec3(cosine + cosine, -sine - cosine, sine - cosine) * z - kx, 0.0, 1.0);
    for (int rootIndex = 0; rootIndex < 3; rootIndex += 1) {
      float t = roots[rootIndex];
      vec2 delta = dd + (cc + bb * t) * t;
      best = min(best, dot(delta, delta));
    }
  }
  return sqrt(max(best, 0.0));
}

void main() {
  float dx = length(vec2(dFdx(vLocal.x), dFdy(vLocal.x)));
  float dy = length(vec2(dFdx(vLocal.y), dFdy(vLocal.y)));
  float localPerPixel = max(max(dx, dy), 1e-6);
  if (vAlpha <= 0.001) discard;
  if (
    vHasClipBounds >= 0.5 &&
    (vLocal.x < vClipBounds.x || vLocal.y < vClipBounds.y || vLocal.x > vClipBounds.z || vLocal.y > vClipBounds.w)
  ) discard;

  float distanceValue = uStrokeCurveEnabled >= 0.5 && vPrimitiveType >= 0.5
    ? distanceToQuadratic(vLocal, vP0, vP1, vP2)
    : distanceToLine(vLocal, vP0, vP2);
  float aaWorld = max(localPerPixel * uAAScreenPx, 5e-5);
  float halfWidth = vIsHairline >= 0.5 ? max(0.5 * localPerPixel, 1e-5) : vHalfWidth;
  float coverage = heprStrokeCoverage(distanceValue, halfWidth, aaWorld);

  vec4 source = vSourceGradientIndex >= 0
    ? samplePdfGradient(vSourceGradientIndex, vLocal)
    : vec4(vSolidColor, 1.0);
  float maskAlpha = vMaskGradientIndex >= 0 ? samplePdfGradient(vMaskGradientIndex, vLocal).a : 1.0;
  float alpha = coverage * vAlpha * source.a * maskAlpha;
  if (alpha <= 0.001) discard;
  vec3 baseColor = uPrimitiveOverride.a > 0.5 ? uPrimitiveOverride.rgb : source.rgb;
  vec3 color = mix(baseColor, uVectorOverride.rgb, clamp(uVectorOverride.a, 0.0, 1.0));
  outColor = vec4(color, clamp(alpha, 0.0, 1.0) * heprVectorClipAA(vLocal, localPerPixel));
}
`;function vr(e){return`
  let bandInfo = ${e.bands};
  let bandCount = i32(bandInfo.y);
  let bandTextureWidth = i32(textureDimensions(${e.texture}).x);
  var firstBand = 0;
  var lastBand = 0;
  if (bandCount > 0) {
    firstBand = clamp(i32(floor((${e.y} - ${e.radius} - bandInfo.z) / bandInfo.w)), 0, bandCount - 1);
    lastBand = clamp(i32(floor((${e.y} + ${e.radius} - bandInfo.z) / bandInfo.w)), 0, bandCount - 1);
  }
  for (var band = firstBand; band <= lastBand; band = band + 1) {
    var bandSegmentCount = ${e.count};
    var entry = 0;
    if (bandCount > 0) {
      let tableIndex = i32(bandInfo.x) + band;
      let range = textureLoad(${e.texture}, vec2<i32>(tableIndex % bandTextureWidth, tableIndex / bandTextureWidth), 0);
      entry = i32(range.x);
      bandSegmentCount = i32(range.y);
    }
    ${e.setup??``}
    for (var bandSegment = 0; bandSegment < bandSegmentCount; bandSegment = bandSegment + 1) {
      var segmentIndex = ${e.start} + bandSegment;
      if (bandCount > 0) {
        let packedIndex = entry + bandSegment;
        let texel = i32(${e.entries}) + (packedIndex >> 2);
        let packed = textureLoad(${e.texture}, vec2<i32>(texel % bandTextureWidth, texel / bandTextureWidth), 0);
        segmentIndex = i32(packed[packedIndex & 3]);
      }
      ${e.edge}
    }
  }
`}const yr=`
${mn}
fn gradientCoord(index : i32) -> vec2i {
  let dimensions = textureDimensions(uGradientMetaA);
  return vec2i(index % i32(dimensions.x), index / i32(dimensions.x));
}

${r}
${u}

fn samplePdfGradient(index : i32, scenePoint : vec2f) -> vec4f {
  let gradientCount = i32(textureDimensions(uGradientLut).y);
  if (index < 0 || index >= gradientCount) {
    return vec4f(0.0);
  }
  let coord = gradientCoord(index);
  let metaA = textureLoad(uGradientMetaA, coord, 0);
  let metaB = textureLoad(uGradientMetaB, coord, 0);
  let metaC = textureLoad(uGradientMetaC, coord, 0);
  let metaD = textureLoad(uGradientMetaD, coord, 0);
  let metaE = textureLoad(uGradientMetaE, coord, 0);
  let transform = mat2x2f(vec2f(metaB.x, metaB.y), vec2f(metaB.z, metaB.w));
  let point = transform * scenePoint + metaC.xy;

  if (
    metaA.y >= 0.5 &&
    (point.x < metaE.x || point.y < metaE.y || point.x > metaE.z || point.y > metaE.w)
  ) {
    return vec4f(0.0);
  }

  let parameter = heprGradientParameter(metaA, metaC, metaD, point);
  if (parameter.y < 0.5) { return heprGradientBackground(metaA.w); }
  let t = parameter.x;

  let lutX = (clamp(t, 0.0, 1.0) * 1023.0 + 0.5) / 1024.0;
  let lutY = (f32(index) + 0.5) / f32(max(gradientCount, 1));
  return textureSampleLevel(uGradientLut, uGradientSampler, vec2f(lutX, lutY), 0.0);
}

fn cornerFromVertexIndex(vertexIndex : u32) -> vec2f {
  switch (vertexIndex & 3u) {
    case 0u: { return vec2f(-1.0, -1.0); }
    case 1u: { return vec2f(1.0, -1.0); }
    case 2u: { return vec2f(-1.0, 1.0); }
    default: { return vec2f(1.0, 1.0); }
  }
}

fn coordFromIndex(index : i32, width : i32) -> vec2i {
  return vec2i(index % width, index / width);
}

fn distanceToLine(point : vec2f, start : vec2f, end : vec2f) -> f32 {
  let delta = end - start;
  let lengthSquared = dot(delta, delta);
  if (lengthSquared <= 1e-10) {
    return length(point - start);
  }
  let t = clamp(dot(point - start, delta) / lengthSquared, 0.0, 1.0);
  return length(point - (start + delta * t));
}

fn distanceToQuadratic(point : vec2f, p0 : vec2f, p1 : vec2f, p2 : vec2f) -> f32 {
  let aa = p1 - p0;
  let bb = p0 - 2.0 * p1 + p2;
  let cc = aa * 2.0;
  let dd = p0 - point;
  let bbLengthSquared = dot(bb, bb);
  if (bbLengthSquared <= 1e-12) {
    return distanceToLine(point, p0, p2);
  }
  let inverse = 1.0 / bbLengthSquared;
  let kx = inverse * dot(aa, bb);
  let ky = inverse * (2.0 * dot(aa, aa) + dot(dd, bb)) / 3.0;
  let kz = inverse * dot(dd, aa);
  let p = ky - kx * kx;
  let q = kx * (2.0 * kx * kx - 3.0 * ky) + kz;
  let h = q * q + 4.0 * p * p * p;
  var best = 1e20;
  if (h >= 0.0) {
    let hSqrt = sqrt(h);
    let roots = (vec2f(hSqrt, -hSqrt) - q) * 0.5;
    let uv = sign(roots) * pow(abs(roots), vec2f(1.0 / 3.0));
    let t = clamp(uv.x + uv.y - kx, 0.0, 1.0);
    let delta = dd + (cc + bb * t) * t;
    best = dot(delta, delta);
  } else {
    let z = sqrt(-p);
    let angle = acos(clamp(q / (2.0 * p * z), -1.0, 1.0)) / 3.0;
    let cosine = cos(angle);
    let sine = sin(angle) * 1.732050808;
    let roots = clamp(vec3f(cosine + cosine, -sine - cosine, sine - cosine) * z - kx, vec3f(0.0), vec3f(1.0));
    for (var rootIndex = 0; rootIndex < 3; rootIndex = rootIndex + 1) {
      let t = roots[rootIndex];
      let delta = dd + (cc + bb * t) * t;
      best = min(best, dot(delta, delta));
    }
  }
  return sqrt(max(best, 0.0));
}

fn quadraticPoint(p0 : vec2f, p1 : vec2f, p2 : vec2f, t : f32) -> vec2f {
  let oneMinusT = 1.0 - t;
  return oneMinusT * oneMinusT * p0 + 2.0 * oneMinusT * t * p1 + t * t * p2;
}
`;function br(e){return`
@group(2) @binding(0) var<uniform> uPrimitiveOverride : vec4f;
@group(1) @binding(0) var uVectorClipTex : texture_2d<f32>;
// x of index is the paint's clip; bounds are its clip chain's world bounds,
// unbounded for unclipped and per-instance clips.
struct VectorClipUniform { index : vec4f, bounds : vec4f };
@group(1) @binding(1) var<uniform> uVectorClip : VectorClipUniform;
@group(0) @binding(GRADIENT_META_A_BINDING) var uGradientMetaA : texture_2d<f32>;
@group(0) @binding(GRADIENT_META_B_BINDING) var uGradientMetaB : texture_2d<f32>;
@group(0) @binding(GRADIENT_META_C_BINDING) var uGradientMetaC : texture_2d<f32>;
@group(0) @binding(GRADIENT_META_D_BINDING) var uGradientMetaD : texture_2d<f32>;
@group(0) @binding(GRADIENT_META_E_BINDING) var uGradientMetaE : texture_2d<f32>;
@group(0) @binding(GRADIENT_SAMPLER_BINDING) var uGradientSampler : sampler;
@group(0) @binding(GRADIENT_LUT_BINDING) var uGradientLut : texture_2d<f32>;
`.replace(`GRADIENT_META_A_BINDING`,String(e)).replace(`GRADIENT_META_B_BINDING`,String(e+1)).replace(`GRADIENT_META_C_BINDING`,String(e+2)).replace(`GRADIENT_META_D_BINDING`,String(e+3)).replace(`GRADIENT_META_E_BINDING`,String(e+4)).replace(`GRADIENT_SAMPLER_BINDING`,String(e+5)).replace(`GRADIENT_LUT_BINDING`,String(e+6))}const xr=`

struct CameraUniforms {
  viewport : vec2f,
  cameraCenter : vec2f,
  zoom : f32,
  strokeAAScreenPx : f32,
  strokeCurveEnabled : f32,
  textAAScreenPx : f32,
  textCurveEnabled : f32,
  fillAAScreenPx : f32,
  textVectorOnly : f32,
  pad0 : f32,
  vectorOverride : vec4f,
  fillBands : vec4f,
  fillCells : vec4f,
};

@group(0) @binding(0) var<uniform> uCamera : CameraUniforms;
@group(0) @binding(1) var uPathMetaA : texture_2d<f32>;
@group(0) @binding(2) var uPathMetaB : texture_2d<f32>;
@group(0) @binding(3) var uPathMetaC : texture_2d<f32>;
@group(0) @binding(4) var uPaintMeta : texture_2d<f32>;
@group(0) @binding(5) var uSegmentsA : texture_2d<f32>;
@group(0) @binding(6) var uSegmentsB : texture_2d<f32>;
${br(7)}
${yr}

fn heprFillBandInfo(pathIndex: f32, base: f32, segments: texture_2d<f32>) -> vec4<f32> {
  if (base < 0.0) { return vec4<f32>(0.0); }
  let width = i32(textureDimensions(segments).x);
  let index = i32(base + pathIndex);
  return textureLoad(segments, vec2<i32>(index % width, index / width), 0);
}


fn heprFillCellInfo(pathIndex: f32, headers: f32, segments: texture_2d<f32>) -> vec4<f32> {
  if (headers <= 0.0) { return vec4<f32>(0.0); }
  let width = i32(textureDimensions(segments).x);
  let index = i32(headers - 1.0 + pathIndex);
  return textureLoad(segments, vec2<i32>(index % width, index / width), 0);
}


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

${dn}

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


struct FillOut {
  @builtin(position) position : vec4f,
  @location(0) local : vec2f,
  @location(1) @interpolate(flat) segmentStart : i32,
  @location(2) @interpolate(flat) segmentCount : i32,
  @location(3) @interpolate(flat) solidColor : vec3f,
  @location(4) @interpolate(flat) alpha : f32,
  @location(5) @interpolate(flat) fillRule : f32,
  @location(6) @interpolate(flat) companionStroke : f32,
  @location(7) @interpolate(flat) sourceGradient : i32,
  @location(8) @interpolate(flat) maskGradient : i32,
  @location(9) @interpolate(flat) bands : vec4f,
  @location(10) @interpolate(flat) cells : vec4f,
  @location(11) @interpolate(flat) origin : vec2f,
};

@vertex
fn vsMain(@builtin(vertex_index) vertexIndex : u32) -> FillOut {
  let pathIndex = i32(vertexIndex / 4u);
  let dimensions = textureDimensions(uPathMetaA);
  let coord = coordFromIndex(pathIndex, i32(dimensions.x));
  let metaA = textureLoad(uPathMetaA, coord, 0);
  let metaB = textureLoad(uPathMetaB, coord, 0);
  let metaC = textureLoad(uPathMetaC, coord, 0);
  let paintMeta = textureLoad(uPaintMeta, coord, 0);
  let segmentCount = i32(metaA.y);
  let alpha = metaC.w;
  var out : FillOut;
  out.bands = heprFillBandInfo(f32(pathIndex), uCamera.fillBands.z, uSegmentsA);
  out.cells = heprFillCellInfo(f32(pathIndex), uCamera.fillCells.y, uSegmentsA);
  out.origin = metaA.zw;
  
  let margin = heprCoverageMargin(mat2x2f(uCamera.zoom, 0.0, 0.0, uCamera.zoom));
  
  
  let low = max(metaA.zw, uVectorClip.bounds.xy) - margin;
  let high = min(metaB.xy, uVectorClip.bounds.zw) + margin;
  if (segmentCount <= 0 || alpha <= 0.001 || any(low > high)) {
    out.position = vec4f(-2.0, -2.0, 0.0, 1.0);
    out.local = vec2f(0.0);
    out.segmentStart = 0;
    out.segmentCount = 0;
    out.solidColor = vec3f(0.0);
    out.alpha = 0.0;
    out.fillRule = 0.0;
    out.companionStroke = 0.0;
    out.sourceGradient = -1;
    out.maskGradient = -1;
    return out;
  }
  let corner = cornerFromVertexIndex(vertexIndex) * 0.5 + 0.5;
  let world = mix(low, high, corner);
  let screen = (world - uCamera.cameraCenter) * uCamera.zoom + 0.5 * uCamera.viewport;
  out.position = vec4f((screen / (0.5 * uCamera.viewport)) - 1.0, 0.0, 1.0);
  out.local = world;
  out.segmentStart = i32(metaA.x);
  out.segmentCount = segmentCount;
  out.solidColor = vec3f(metaB.z, metaB.w, metaC.z);
  out.alpha = alpha;
  out.fillRule = metaC.x;
  out.companionStroke = metaC.y;
  out.sourceGradient = i32(round(paintMeta.x));
  out.maskGradient = i32(round(paintMeta.y));
  return out;
}

@fragment
fn fsMain(inData : FillOut) -> @location(0) vec4f {
  
  
  let dx = length(vec2f(dpdx(inData.local.x), dpdy(inData.local.x)));
  let dy = length(vec2f(dpdx(inData.local.y), dpdy(inData.local.y)));
  let aaWidth = max(max(dx, dy) * uCamera.fillAAScreenPx, 1e-4);
  let footprint = max(vec2f(dx, dy) * uCamera.fillAAScreenPx, vec2f(1e-4));
  if (inData.segmentCount <= 0 || inData.alpha <= 0.001) { discard; }
  let dimensions = textureDimensions(uSegmentsA);
  
  
  
  let box = vec4f(inData.local - 0.5 * footprint, 1.0 / footprint);
  var winding = 0.0;
  if (inData.cells.y > 0.0) {
    winding = heprCellWinding(inData.cells, inData.origin, box, footprint, uSegmentsA, uSegmentsB);
  } else {
${vr({bands:`inData.bands`,y:`inData.local.y`,radius:`0.5 * footprint.y`,count:`inData.segmentCount`,start:`inData.segmentStart`,texture:`uSegmentsA`,entries:`uCamera.fillBands.w`,setup:`let rows = heprBandRows(bandInfo, band, bandCount, box);`,edge:`
    let coord = coordFromIndex(segmentIndex, i32(dimensions.x));
    let primitiveA = textureLoad(uSegmentsA, coord, 0);
    let primitiveB = textureLoad(uSegmentsB, coord, 0);
    winding = winding + heprSegmentCoverage(primitiveA.xy, primitiveA.zw, primitiveB.xy,
      primitiveB.z >= 0.5, box, rows.x, rows.y);
`})}
  }
  let coverage = heprFillCoverage(winding, inData.fillRule >= 0.5);
  let source = select(vec4f(inData.solidColor, 1.0), samplePdfGradient(inData.sourceGradient, inData.local), inData.sourceGradient >= 0);
  let maskAlpha = select(1.0, samplePdfGradient(inData.maskGradient, inData.local).a, inData.maskGradient >= 0);
  let alpha = coverage * inData.alpha * source.a * maskAlpha;
  if (alpha <= 0.001) { discard; }
  let baseColor = select(source.rgb, uPrimitiveOverride.rgb, uPrimitiveOverride.a > 0.5);
  let color = mix(baseColor, uCamera.vectorOverride.xyz, clamp(uCamera.vectorOverride.w, 0.0, 1.0));
  return vec4f(color, clamp(alpha, 0.0, 1.0) * heprVectorClipAA(inData.local, uVectorClip.index.x, uVectorClipTex, aaWidth));
}
`;`${cn}${br(6)}${yr}`;const Sr=hr.replace(`uniform sampler2D uPathMetaTexA;`,`layout(location=0) in vec2 aMeshPosition;
layout(location=1) in vec4 aMeshColor;
uniform int uMeshPathIndex;
out vec4 vMeshColor;
uniform sampler2D uPathMetaTexA;`).replace(`int pathIndex = gl_VertexID / 4;`,`vMeshColor = aMeshColor;
  int pathIndex = uMeshPathIndex;`).replace(`vec2 world = mix(low, high, corner01);`,`vec2 world = aMeshPosition;`),Cr=gr.replace(`uniform sampler2D uSegmentTexA;`,`in vec4 vMeshColor;
uniform sampler2D uSegmentTexA;`).replace(`vec4 source = vSourceGradientIndex >= 0
    ? samplePdfGradient(vSourceGradientIndex, vLocal)
    : vec4(vSolidColor, 1.0);`,`vec4 source = vMeshColor;
  ivec2 meshCoord = gradientCoord(vSourceGradientIndex);
  vec4 meshA = texelFetch(uGradientMetaTexA, meshCoord, 0);
  vec4 meshB = texelFetch(uGradientMetaTexB, meshCoord, 0);
  vec4 meshC = texelFetch(uGradientMetaTexC, meshCoord, 0);
  vec4 meshE = texelFetch(uGradientMetaTexE, meshCoord, 0);
  vec2 meshPoint = mat2(meshB.x, meshB.y, meshB.z, meshB.w) * vLocal + meshC.xy;
  if (meshA.y >= 0.5 && (meshPoint.x < meshE.x || meshPoint.y < meshE.y || meshPoint.x > meshE.z || meshPoint.y > meshE.w)) discard;`);xr.replace(`struct FillOut {`,`struct FillOut {
  @location(12) meshColor : vec4f,`).replace(`fn vsMain(@builtin(vertex_index) vertexIndex : u32) -> FillOut {`,`fn vsMain(@builtin(vertex_index) vertexIndex : u32, @builtin(instance_index) paintIndex : u32,
    @location(0) meshPosition : vec2f, @location(1) meshColor : vec4f) -> FillOut {`).replace(`let pathIndex = i32(vertexIndex / 4u);`,`let pathIndex = i32(paintIndex);`).replace(`var out : FillOut;`,`var out : FillOut;
  out.meshColor = meshColor;`).replace(`let world = mix(low, high, corner);`,`let world = meshPosition;`).replace(`let source = select(vec4f(inData.solidColor, 1.0), samplePdfGradient(inData.sourceGradient, inData.local), inData.sourceGradient >= 0);`,`let source = inData.meshColor;
  let meshCoord = gradientCoord(inData.sourceGradient);
  let meshA = textureLoad(uGradientMetaA, meshCoord, 0);
  let meshB = textureLoad(uGradientMetaB, meshCoord, 0);
  let meshC = textureLoad(uGradientMetaC, meshCoord, 0);
  let meshE = textureLoad(uGradientMetaE, meshCoord, 0);
  let meshPoint = mat2x2f(meshB.xy, meshB.zw) * inData.local + meshC.xy;
  if (meshA.y >= 0.5 && (meshPoint.x < meshE.x || meshPoint.y < meshE.y || meshPoint.x > meshE.z || meshPoint.y > meshE.w)) { discard; }`);function wr(e,t,n,r,i,a,o,s,c){if(!r)return null;let l=r({minX:0,minY:0,maxX:1,maxY:1});if(!l)return null;let u=i/o,d=a/s,f=c?-1:1;return Er(e,t,n,[l.width*u,0,l.x*u,0,l.height*d*f,c?a-l.y*d:l.y*d,0,0,1])}function Tr(e,t,n){for(let r=t??-1,i=0;r>=0&&i<256;i++){if(r===n)return!0;r=e.clipPaths?.[r]?.parent??-1}return!1}function Er(e,t,n,r){let i=t.first,a=e.gradientFillPaintMeta,o=e.gradientFillPathMetaA;if(t.kind!==`gradient-fill`||t.count!==1||!a||!o||!e.gradientFillPathMetaC||i<0||i*4+3>=a.length)return null;let s=a[i*4],c=s*4;if(!(s>=0&&s<e.gradientCount)||a[i*4+1]>=0)return null;let{gradientMetaA:l,gradientMetaB:u,gradientMetaC:d,gradientMetaD:f,gradientMetaE:p}=e;if(!l||!u||!d||!f||!p||c+3>=l.length||l[c]>1.5)return null;let m=[],h=[],g=e.gradientFillSegmentsA,_=e.gradientFillSegmentsB;for(let e=o[i*4],t=e+o[i*4+1];e<t;e++){let t=e*4;if(!g||!_||t+3>=g.length||_[t+2]>=1)return null;h.push(g[t],g[t+1],_[t],_[t+1])}m.push(h);let v=t.clipIndex??-1;if(v>=0&&!Tr(e,n,v)){let t=e.clipPaths?.[v];if(!t||t.parent>=0&&!Tr(e,n,t.parent))return null;m.push(Array.from(t.edges))}let y=(e,t)=>{let n=r[6]*e+r[7]*t+r[8];return n>1e-6?[(r[0]*e+r[1]*t+r[2])/n,(r[3]*e+r[4]*t+r[5])/n]:null},b=/* @__PURE__ */ new Float32Array(60),x=7;for(let e of m){let t=[];for(let n=0;n<e.length;n+=4){let r=y(e[n],e[n+1]),i=(n+4)%e.length;if(!r||Math.hypot(e[n+2]-e[i],e[n+3]-e[i+1])>1e-5*(1+Math.abs(e[i])+Math.abs(e[i+1])))return null;t.push(r)}if(t.length<3)return null;let n=t.reduce((e,n)=>[e[0]+n[0]/t.length,e[1]+n[1]/t.length],[0,0]),r=0;for(let e=0;e<t.length;e++){let[n,i]=t[e],[a,o]=t[(e+1)%t.length],[s,c]=t[(e+2)%t.length],l=(a-n)*(c-o)-(o-i)*(s-a),u=Math.hypot(a-n,o-i)*Math.hypot(s-a,c-o);if(!(Math.abs(l)<=1e-6*u)){if(r&&Math.sign(l)!==r)return null;r=Math.sign(l)}}if(!r)return null;for(let e=0;e<t.length;e++){let[r,i]=t[e],[a,o]=t[(e+1)%t.length],s=Math.hypot(a-r,o-i);if(s<1e-9)continue;if(x>=15)return null;let c=(i-o)/s,l=(a-r)/s,u=-(c*r+l*i);c*n[0]+l*n[1]+u<0&&(c=-c,l=-l,u=-u),b.set([c,l,u,0],x++*4)}}for(;x<15;x++)b.set([0,0,1,0],x*4);let[S,C,w,T,E,D,O,k,A]=r,j=[E*A-D*k,w*k-C*A,C*D-w*E,D*O-T*A,S*A-w*O,w*T-S*D,T*k-E*O,C*O-S*k,S*E-C*T],M=S*j[0]+C*j[3]+w*j[6];if(!(Math.abs(M)>0)||!Number.isFinite(M))return null;for(let e=0;e<9;e++)j[e]/=M;let N=[...[0,1,2].map(e=>u[c]*j[e]+u[c+2]*j[e+3]+d[c]*j[e+6]),...[0,1,2].map(e=>u[c+1]*j[e]+u[c+3]*j[e+3]+d[c+1]*j[e+6]),...j.slice(6)],P=Math.max(...N.map(Math.abs));if(!(P>0)||!Number.isFinite(P))return null;for(let e=0;e<3;e++)b.set([N[e*3]/P,N[e*3+1]/P,N[e*3+2]/P,0],e*4);return b.set(l.subarray(c,c+4),12),b.set([d[c+2],d[c+3],f[c],f[c+1]],16),b.set([f[c+2],f[c+3],e.gradientFillPathMetaC[i*4+3],s],20),b.set(p.subarray(c,c+4),24),b}let Dr=-1/0;function Or(e,t){return{blendsPasses:e.blendsPasses,acquire:()=>(t.peak=Math.max(t.peak,++t.live),e.acquire()),release:n=>{t.live--,e.release(n)},clear:(n,r,i)=>{t.clears++,e.clear(n,r,i)},copy:(n,r,i)=>{t.copies++,e.copy(n,r,i)},draw:(n,r,i)=>{t.spans++,t.runs+=n.length,e.draw(n,r,i)},pass:(n,r)=>{t.passes++,e.pass(n,r)},canFold:e.canFold&&(t=>e.canFold(t)),canFoldMaskPaint:e.canFoldMaskPaint&&((t,n)=>e.canFoldMaskPaint(t,n)),drawFolded:e.drawFolded&&((n,r,i,a,o,s)=>{t.folds++,e.drawFolded(n,r,i,a,o,s)})}}function kr(e,t,n,r,i,a){if(!e||!t||!Number.isFinite(e.minX)||!Number.isFinite(e.minY)||!Number.isFinite(e.maxX)||!Number.isFinite(e.maxY))return null;let o=t(e);if(!o)return null;let s=i/Math.max(1,n),c=a/Math.max(1,r),l=Math.floor((o.x-2)*s),u=Math.floor((o.y-2)*c),d=Math.ceil((o.x+o.width+2)*s),f=Math.ceil((o.y+o.height+2)*c),p=Math.max(0,Math.min(i,l)),m=Math.max(0,Math.min(a,u)),h=Math.max(0,Math.min(i,d)-p),g=Math.max(0,Math.min(a,f)-m);return p===0&&m===0&&h>=i&&g>=a?null:{x:p,y:m,width:h,height:g}}function Ar(e,t,n,r,a=null,o=!1,s=!0,c=!0){let l=globalThis.HEPR_DEBUG_COMPOSITE_STATS===!0?{clears:0,copies:0,passes:0,spans:0,runs:0,folds:0,live:0,peak:0}:null;l&&(t=Or(t,l));let u=/* @__PURE__ */ new Set,d=()=>{let e=t.acquire();return u.add(e),e},f=e=>{u.delete(e)&&t.release(e)},p=e=>{let n=d();return t.clear(n,void 0,e),n},m=(e,n)=>{let r=d();return t.copy(e,r,n),r},h=Ge(e,s,c),g=e=>h.nodes.get(e),_=e=>{let t=e*4,n=h.runs;if(!(!n||t+3>=n.length||!Number.isFinite(n[t])))return{minX:n[t],minY:n[t+1],maxX:n[t+2],maxY:n[t+3]}},v=(e,t)=>{if(e&&t)return{minX:Math.min(e.minX,t.minX),minY:Math.min(e.minY,t.minY),maxX:Math.max(e.maxX,t.maxX),maxY:Math.max(e.maxY,t.maxY)}},y=e=>{f(e.color),e.shape&&f(e.shape),e.mask&&f(e.mask)},b=(e,n,r)=>{let i=p(r);if(t.draw(e,i,!1),!n)return{color:i,shape:null};let a=p(r);return t.draw(e,a,!0),{color:i,shape:a}},x=/* @__PURE__ */ new Map,S=t=>{let n=x.get(t);if(n!==void 0)return n;let i=!1;for(let n of t)if(r(n.optionalContent)){if(n.kind===`group`){if(!S(n.children))continue}else if(n.kind===`draw`&&(a&&!a[n.runIndex]||!r(e.drawRuns[n.runIndex].optionalContent)))continue;i=!0;break}return x.set(t,i),i},C=t=>{if(t.kind===`draw`&&a&&!a[t.runIndex])return null;let n=t.kind===`draw`?e.drawRuns[t.runIndex]:{kind:`raster`,first:t.rasterIndex,count:1};return r(n.optionalContent)?n:null},w=e=>{let t=null;for(let n of e)if(r(n.optionalContent)&&!(n.kind===`group`?!S(n.children):!C(n))){if(t)return null;t=n}return t},T=e=>{if(!t.drawFolded||e.blendMode!==`Normal`)return null;let n=e,r=1,i=!1,a;for(;n.kind===`group`;){if(n.knockout||n!==e&&n.blendMode!==`Normal`&&!i)return null;if(n.softMask){if(a)return null;a=n}r*=n.alpha,i=n.isolated;let t=w(n.children);if(!t)return null;n=t}if(n.kind!==`draw`)return null;let o=C(n);return!o||o.count!==1||o.blendMode&&!i||!t.canFold?.(o)?null:{run:{...o,blendMode:void 0},opacity:r,mask:a}},E=e=>{if(e.transfer?.length||!t.canFoldMaskPaint)return null;let n=w(e.children),r=n?.kind===`draw`?C(n):null;return r&&r.count===1?{...r,blendMode:void 0}:null},D=(e,n,a)=>{let o=[],s=()=>{if(o.length===0)return;let e=o;o=[],t.draw(e,n,!1)},c=(e,r,i)=>{if(r===0&&t.blendsPasses){t.pass({operation:6,source:e.color,opacity:e.opacity,mask:e.mask,isolated:e.opacity!==void 0,blend:!0,bounds:i},n),y(e);return}let a=d();t.copy(n,a,i),t.pass({operation:0,source:e.color,shape:e.shape??void 0,current:a,blendMode:r,opacity:e.opacity,mask:e.mask,isolated:e.opacity!==void 0,bounds:i},n),f(a),y(e)};for(let l of e){if(!r(l.optionalContent))continue;if(l.kind===`group`){if(!S(l.children))continue;s();let e=T(l);if(e){let r=e.mask?.softMask,i=r&&E(r);if(i&&t.canFoldMaskPaint(e.run,i)){t.drawFolded(e.run,n,e.opacity,void 0,r,i);continue}let o=r&&!r.transfer?.length?r:void 0,s=e.mask&&g(e.mask.children),c=r&&(o?k(r,a+2,s):O(r,a+2,s));t.drawFolded(e.run,n,e.opacity,c,o),c&&f(c);continue}c(j(l.children,n,l,a+1,!1),ke.indexOf(l.blendMode),g(l.children));continue}let e=C(l);if(!e)continue;if(e.blendMode){s();let t=l.kind===`draw`?_(l.runIndex):void 0;for(let n=e.first;n<e.first+e.count;n++)c(b([{...e,first:n,count:1,blendMode:void 0}],!1,t),ke.indexOf(e.blendMode),t);continue}let u=o[o.length-1];i(u,e)?u.count+=e.count:o.push({...e,blendMode:void 0})}return s(),n},O=(e,n,r)=>{let i=v(g(e.children),r),a=k(e,n,r),o=d();return t.pass({operation:4,source:a,softMask:e,bounds:i},o),f(a),o},k=(e,t,n)=>D(e.children,p(v(g(e.children),n)),t),A=(e,t,n)=>{let r=g(e),i=t.softMask?O(t.softMask,n+1,r):void 0,a=D(e,p(r),n);return t.alpha===1&&!i?{color:a,shape:null}:{color:a,shape:null,opacity:t.alpha,mask:i}},j=(e,n,a,o,s)=>{if(a.isolated&&!a.knockout&&!s)return A(e,a,o);let c=s||a.knockout,l=g(e),u=a.softMask?O(a.softMask,o+1,l):void 0,h=a.isolated?p(l):m(n,l),_=m(h,l),v=p(l),x=d(),w=d(),T=(e,n)=>{let r={source:e.color,shape:e.shape??void 0,current:_,stats:v,initial:h,blendMode:n,knockout:a.knockout,bounds:l,opacity:e.opacity,mask:e.mask,isolated:e.opacity!==void 0};t.pass({...r,operation:0},x),t.pass({...r,operation:1},w),[_,x]=[x,_],[v,w]=[w,v],y(e)},E=[],D=e=>{let t=E[E.length-1];i(t,e)?t.count+=e.count:E.push({...e,blendMode:void 0})},k=()=>{if(E.length===0)return;let e=E;E=[],T(b(e,c,l),0)};for(let t of e)if(r(t.optionalContent)){if(t.kind===`group`){if(!S(t.children))continue;k(),T(j(t.children,a.knockout?h:_,t,o+1,c),ke.indexOf(t.blendMode))}else{let e=C(t);if(!e)continue;if(a.knockout||e.blendMode){k();for(let t=e.first;t<e.first+e.count;t++)T(b([{...e,first:t,count:1,blendMode:void 0}],c,l),ke.indexOf(e.blendMode??`Normal`))}else D(e)}}k();let M={color:d(),shape:s?d():null},N={current:_,stats:v,initial:h,mask:u,bounds:l,opacity:a.alpha,alphaIsShape:a.alphaIsShape};t.pass({...N,operation:2},M.color),M.shape&&t.pass({...N,operation:3},M.shape),u&&f(u);for(let e of[h,_,v,x,w])f(e);return M};try{let t=D(Ie(e,s,c),o?n:m(n),0);return u.delete(t),t}finally{for(let e of u)t.release(e);l&&performance.now()-Dr>=1e3&&(Dr=performance.now(),console.info(`[hepr] PDF composite frame: ${l.clears+l.copies+l.passes} surface ops (${l.passes} passes, ${l.clears} clears, ${l.copies} copies), ${l.spans} span draws over ${l.runs} paints, ${l.folds} folded paints, ${l.peak} peak surfaces.`))}}var jr=class{plan=null;scene=null;roots;runs;revision;structure=0;width=0;height=0;blendsPasses;colorBatchingEnabled;blackDarkenSourceOverEnabled;selected=null;reused=!1;operations=0;execute(e,t,n,r,i,a,o,s,c,l=!0,u=!0){if(a===void 0||globalThis.HEPR_DEBUG_COMPOSITE_STATS)return this.clear(),Ar(e,t,n,r,i,!0,l,u);let d=this.plan&&this.scene===e&&this.roots===e.paintGraph&&this.runs===e.drawRuns&&this.revision===a&&this.structure===o&&this.width===s&&this.height===c&&this.blendsPasses===t.blendsPasses&&this.colorBatchingEnabled===l&&this.blackDarkenSourceOverEnabled===u&&Mr(this.selected,i)&&this.plan.capabilities.every(e=>(e.maskRun?t.canFoldMaskPaint?.(e.run,e.maskRun):t.canFold?.(e.run))===e.accepted);if(this.reused=!!d,!d){this.plan=null;let n=Nr(e,t,r,i,l,u);this.scene=e,this.roots=e.paintGraph,this.runs=e.drawRuns,this.revision=a,this.structure=o,this.width=s,this.height=c,this.blendsPasses=t.blendsPasses,this.colorBatchingEnabled=l,this.blackDarkenSourceOverEnabled=u,this.selected=i?.slice()??null,this.plan=n}return this.operations=this.plan.operations.length,Pr(this.plan,t,n)}clear(){this.plan=null,this.scene=null,this.roots=void 0,this.runs=void 0,this.selected=null,this.reused=!1,this.operations=0}};function Mr(e,t){if(!e||!t)return e===t;if(e.length!==t.length)return!1;for(let n=0;n<t.length;n++)if(t[n]!==e[n])return!1;return!0}function Nr(e,t,n,r,i,a){let o=[],s=[],c=0;return{operations:o,capabilities:s,result:Ar(e,{blendsPasses:t.blendsPasses,acquire:()=>{let e=++c;return o.push({kind:`acquire`,surface:e}),e},release:e=>{o.push({kind:`release`,surface:e})},clear:(e,t,n)=>{o.push({kind:`clear`,surface:e,color:t,bounds:n})},copy:(e,t,n)=>{o.push({kind:`copy`,source:e,destination:t,bounds:n})},draw:(e,t,n)=>{o.push({kind:`draw`,runs:e,destination:t,shapeOnly:n})},pass:(e,t)=>{o.push({kind:`pass`,operation:e,destination:t})},canFold:t.canFold&&(e=>{let n=t.canFold(e);return s.push({run:e,accepted:n}),n}),canFoldMaskPaint:t.canFoldMaskPaint&&((e,n)=>{let r=t.canFoldMaskPaint(e,n);return s.push({run:e,maskRun:n,accepted:r}),r}),drawFolded:t.drawFolded&&((e,t,n,r,i,a)=>{o.push({kind:`fold`,run:e,destination:t,opacity:n,mask:r,content:i,maskRun:a})})},0,n,r,!0,i,a)}}function Pr(e,t,n){let r=/* @__PURE__ */ new Map([[0,n]]),i=e=>r.get(e),a=e=>e===void 0?void 0:i(e);try{for(let n of e.operations)switch(n.kind){case`acquire`:r.set(n.surface,t.acquire());break;case`release`:{let e=i(n.surface);r.delete(n.surface),t.release(e);break}case`clear`:t.clear(i(n.surface),n.color,n.bounds);break;case`copy`:t.copy(i(n.source),i(n.destination),n.bounds);break;case`draw`:t.draw(n.runs,i(n.destination),n.shapeOnly);break;case`pass`:{let e=n.operation;t.pass({...e,source:a(e.source),shape:a(e.shape),current:a(e.current),stats:a(e.stats),initial:a(e.initial),mask:a(e.mask)},i(n.destination));break}case`fold`:n.maskRun&&t.canFoldMaskPaint(n.run,n.maskRun),t.drawFolded(n.run,i(n.destination),n.opacity,a(n.mask),n.content,n.maskRun)}let n=i(e.result);return r.delete(e.result),n}finally{r.delete(0);for(let e of r.values())t.release(e)}}function Fr(e){let t=e===`wgsl`,n=e=>({F:`f32`,I:`i32`,V3:`vec3f`,V4:`vec4f`})[e]??e,r=e=>t?e.replace(/\b(F|I|V3|V4)\b/g,n):e.replace(/\bF\b/g,`float`).replace(/\bI\b/g,`int`).replace(/\bV3\b/g,`vec3`).replace(/\bV4\b/g,`vec4`),i=(e,n,i,a)=>{let o=n.split(`,`).map(e=>e.trim().split(` `));return r(t?`fn ${e}(${o.map(([e,t])=>`${t}: ${e}`).join(`, `)}) -> ${i} {${a}}`:`${i} ${e}(${n}) {${a}}`)},a=(e,n,r)=>t?`var ${n}: ${e} = ${r};`:`${e} ${n} = ${r};`;return[i(`pdfLum`,`V3 c`,`F`,`return dot(c, V3(0.3, 0.59, 0.11));`),i(`pdfSat`,`V3 c`,`F`,`return max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b);`),i(`pdfSetSat`,`V3 c, F s`,`V3`,`${a(`F`,`n`,`min(min(c.r,c.g),c.b)`)}${a(`F`,`d`,`pdfSat(c)`)}
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
`)}const Ir=`#version 300 es
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
${Fr(`glsl`)}


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
}`;`${Fr(`wgsl`)}`;const Lr=/* @__PURE__ */ new WeakMap;function Rr(){let e=globalThis,t=e.HEPR_DEBUG_COMPOSITE_SCALE;if(t===void 0&&typeof e.location?.search==`string`){let n=new URLSearchParams(e.location.search).get(`compositeScale`);n!==null&&(t=Number(n))}return typeof t==`number`&&Number.isFinite(t)&&t>0&&t<=1?t:1}function zr(e,t,n,r=536870912,i=4){if(!Number.isSafeInteger(t)||!Number.isSafeInteger(n)||t<=0||n<=0||!Number.isFinite(r)||r<=0||!Number.isFinite(i)||i<=0)throw RangeError(`Invalid PDF composite viewport or byte budget.`);let a=Lr.get(e);if(a===void 0){let t=(e,n)=>{if(n>64)throw RangeError(`PDF compositor exceeds its group nesting budget.`);let r=n;for(let i of e)i.kind===`group`&&(r=Math.max(r,t(i.children,n+1)),i.softMask&&(r=Math.max(r,t(i.softMask.children,n+2))));return r};a=8*(t(Ie(e),0)+1)+8,Lr.set(e,a)}let o=Math.min(1,Math.sqrt(r/(t*n*i*a)))*Rr();return{width:Math.max(1,Math.floor(t*o)),height:Math.max(1,Math.floor(n*o)),scale:o,estimatedSurfaces:a}}const Br=[`uSource`,`uShape`,`uCurrent`,`uStats`,`uInitial`,`uMask`],Vr=[`composite`,`stats`,`extract`,`shapeExtract`,`softMask`,`copy`,`blendLayer`],Hr=Br.indexOf(`uMask`),Ur=Br.length,Wr=Br.length+1;var Gr=class{blendsPasses=!0;gl;onDraw;program;lastPassName=`composite`;uniforms;vao;zero;one;transfers=/* @__PURE__ */ new Map;pool=[];paintPlan=new jr;all=/* @__PURE__ */ new Set;width=0;height=0;approximationReported=!1;drawSpan=null;scene=null;gradientMask=null;folding=null;project=null;viewportWidth=0;viewportHeight=0;firstUnit;bound=[];get paintPlanReused(){return this.paintPlan.reused}get paintPlanOperations(){return this.paintPlan.operations}constructor(e,t){this.gl=e,this.onDraw=t;let n=this.shader(e.VERTEX_SHADER,`#version 300 es
precision highp float;
void main() {
  vec2 p=vec2(float((gl_VertexID << 1) & 2),float(gl_VertexID & 2));
  gl_Position=vec4(p*2.0-1.0,0.0,1.0);
}`),r=this.shader(e.FRAGMENT_SHADER,Ir),i=e.createProgram();if(!i)throw Error(`Unable to allocate PDF compositor program.`);if(e.attachShader(i,n),e.attachShader(i,r),e.linkProgram(i),e.deleteShader(n),e.deleteShader(r),!e.getProgramParameter(i,e.LINK_STATUS)){let t=e.getProgramInfoLog(i);throw e.deleteProgram(i),Error(`PDF compositor: ${t}`)}this.program=i,this.uniforms=Object.fromEntries(Br.concat([`uTransfer`,`uParams`,`uExtra`,`uMaskBackdrop`]).map(t=>[t,e.getUniformLocation(i,t)]));let a=e.getParameter(e.MAX_COMBINED_TEXTURE_IMAGE_UNITS);this.firstUnit=a>=19+Wr?19:0;let o=e.getParameter(e.CURRENT_PROGRAM);e.useProgram(i);for(let t=0;t<Br.length;t++)e.uniform1i(this.uniforms[Br[t]],this.firstUnit+t);e.uniform1i(this.uniforms.uTransfer,this.firstUnit+Ur),e.useProgram(o),this.vao=e.createVertexArray(),this.zero=this.constant(/* @__PURE__ */ new Uint8Array(4)),this.one=this.constant(Uint8Array.of(255,255,255,255))}render(e,t,n,r,i,a=null,o=null,s,c=null,l=!0,u,d=!0){let f=this.gl,p=zr(e,t,n);p.scale<1&&!this.approximationReported&&(this.approximationReported=!0,console.warn(`[hepr] PDF composite surfaces use ${p.width}×${p.height} instead of ${t}×${n} to stay within the memory budget.`)),(p.width!==this.width||p.height!==this.height)&&(this.releaseSurfaces(),this.width=p.width,this.height=p.height);let m=s??this.captureState(),{framebuffer:h,viewport:g,clearColor:_}=m;this.bound.length=0,this.drawSpan=r,this.folding=c,this.scene=e,this.project=o,this.viewportWidth=t,this.viewportHeight=n;let v=null,y=null;try{f.disable(f.SCISSOR_TEST),f.disable(f.DEPTH_TEST),v=this.acquire(),f.bindFramebuffer(f.READ_FRAMEBUFFER,h),f.bindFramebuffer(f.DRAW_FRAMEBUFFER,v.framebuffer),f.blitFramebuffer(g[0],g[1],g[0]+t,g[1]+n,0,0,this.width,this.height,f.COLOR_BUFFER_BIT,f.LINEAR),y=this.paintPlan.execute(e,this,v,i,a,u,0,t,n,l,d),f.bindFramebuffer(f.READ_FRAMEBUFFER,y.framebuffer),f.bindFramebuffer(f.DRAW_FRAMEBUFFER,h),f.blitFramebuffer(0,0,this.width,this.height,g[0],g[1],g[0]+t,g[1]+n,f.COLOR_BUFFER_BIT,f.LINEAR)}finally{y&&this.release(y),v&&v!==y&&this.release(v),this.drawSpan=null,this.folding=null,this.scene=null,this.gradientMask=null,this.project=null,f.bindFramebuffer(f.READ_FRAMEBUFFER,m.readFramebuffer),f.bindFramebuffer(f.DRAW_FRAMEBUFFER,h),f.viewport(g[0],g[1],g[2],g[3]),f.clearColor(_[0],_[1],_[2],_[3]),f.blendFuncSeparate(...m.blendFunction),f.blendEquationSeparate(...m.blendEquation),m.blend?f.enable(f.BLEND):f.disable(f.BLEND),m.scissor?f.enable(f.SCISSOR_TEST):f.disable(f.SCISSOR_TEST),m.depth?f.enable(f.DEPTH_TEST):f.disable(f.DEPTH_TEST),f.useProgram(m.program),f.bindVertexArray(m.vao)}}captureState(){let e=this.gl;return{framebuffer:e.getParameter(e.DRAW_FRAMEBUFFER_BINDING),readFramebuffer:e.getParameter(e.READ_FRAMEBUFFER_BINDING),viewport:e.getParameter(e.VIEWPORT),clearColor:e.getParameter(e.COLOR_CLEAR_VALUE),scissor:e.isEnabled(e.SCISSOR_TEST),blend:e.isEnabled(e.BLEND),depth:e.isEnabled(e.DEPTH_TEST),program:e.getParameter(e.CURRENT_PROGRAM),vao:e.getParameter(e.VERTEX_ARRAY_BINDING),blendFunction:[e.getParameter(e.BLEND_SRC_RGB),e.getParameter(e.BLEND_DST_RGB),e.getParameter(e.BLEND_SRC_ALPHA),e.getParameter(e.BLEND_DST_ALPHA)],blendEquation:[e.getParameter(e.BLEND_EQUATION_RGB),e.getParameter(e.BLEND_EQUATION_ALPHA)]}}acquire(){let e=this.pool.pop();if(e)return e;if((this.all.size+1)*this.width*this.height*4>536870912)throw RangeError(`PDF compositing surfaces exceed 512 MiB.`);let t=this.gl,n=t.createTexture(),r=t.createFramebuffer();if(!n||!r)throw n&&t.deleteTexture(n),r&&t.deleteFramebuffer(r),Error(`Unable to allocate PDF compositing surface.`);if(this.stage(n),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MIN_FILTER,t.NEAREST),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MAG_FILTER,t.NEAREST),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_S,t.CLAMP_TO_EDGE),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_T,t.CLAMP_TO_EDGE),t.texImage2D(t.TEXTURE_2D,0,t.RGBA8,this.width,this.height,0,t.RGBA,t.UNSIGNED_BYTE,null),t.bindFramebuffer(t.FRAMEBUFFER,r),t.framebufferTexture2D(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,n,0),t.checkFramebufferStatus(t.FRAMEBUFFER)!==t.FRAMEBUFFER_COMPLETE)throw t.deleteTexture(n),t.deleteFramebuffer(r),Error(`PDF compositing framebuffer is incomplete.`);let i={texture:n,framebuffer:r};return this.all.add(i),i}release(e){this.pool.push(e)}clear(e,t=[0,0,0,0],n){let r=this.gl;this.target(e),r.clearColor(...t);let i=this.scissor(n);i&&(r.enable(r.SCISSOR_TEST),r.scissor(i.x,i.y,i.width,i.height)),r.clear(r.COLOR_BUFFER_BIT),i&&r.disable(r.SCISSOR_TEST)}copy(e,t,n){let r=this.gl,i=this.scissor(n)??{x:0,y:0,width:this.width,height:this.height};i.width!==0&&i.height!==0&&(r.bindFramebuffer(r.READ_FRAMEBUFFER,e.framebuffer),r.bindFramebuffer(r.DRAW_FRAMEBUFFER,t.framebuffer),r.blitFramebuffer(i.x,i.y,i.x+i.width,i.y+i.height,i.x,i.y,i.x+i.width,i.y+i.height,r.COLOR_BUFFER_BIT,r.NEAREST))}scissor(e){return kr(e,this.project,this.viewportWidth,this.viewportHeight,this.width,this.height)}draw(e,t,n){if(e.length===0)return;let r=this.gl;this.target(t),r.enable(r.BLEND),r.blendEquation(r.FUNC_ADD),r.blendFuncSeparate(r.SRC_ALPHA,r.ONE_MINUS_SRC_ALPHA,r.ONE,r.ONE_MINUS_SRC_ALPHA),this.drawSpan(e,n)}canFold(e){return this.folding?.canFold(e)??!1}canFoldMaskPaint(e,t){return this.gradientMask=null,!this.scene||!this.folding?.canFoldMaskPaint?.(e,t)?!1:(this.gradientMask=wr(this.scene,t,e.clipIndex,this.project,this.width,this.height,this.viewportWidth,this.viewportHeight,!1),this.gradientMask!==null)}drawFolded(e,t,n,r,i,a){let o=this.gl;this.target(t),o.enable(o.BLEND),o.blendEquation(o.FUNC_ADD),o.blendFuncSeparate(o.SRC_ALPHA,o.ONE_MINUS_SRC_ALPHA,o.ONE,o.ONE_MINUS_SRC_ALPHA),this.folding.draw(e,n,r?.texture??null,i,a?this.gradientMask:void 0)}pass(e,t){let n=this.gl;this.target(t),e.blend?(n.enable(n.BLEND),n.blendEquation(n.FUNC_ADD),n.blendFuncSeparate(n.ONE,n.ONE_MINUS_SRC_ALPHA,n.ONE,n.ONE_MINUS_SRC_ALPHA)):n.disable(n.BLEND),n.useProgram(this.program),n.bindVertexArray(this.vao),this.lastPassName=Vr[e.operation];let r=[e.source,e.shape,e.current,e.stats,e.initial,e.mask];for(let e=0;e<r.length;e++)this.bind(e,r[e]?.texture??(e===Hr?this.one:this.zero));let i=e.softMask?.transfer;this.bind(Ur,i?this.transferTexture(i):this.zero),n.uniform4f(this.uniforms.uParams,e.operation,e.blendMode??0,+!!e.knockout,e.opacity??1),n.uniform4f(this.uniforms.uExtra,+!!e.alphaIsShape,+(e.softMask?.subtype===`Luminosity`),i?.length??0,+!!e.isolated),n.uniform3fv(this.uniforms.uMaskBackdrop,e.softMask?.backdrop??[0,0,0]);let a=this.scissor(e.bounds);a&&(n.enable(n.SCISSOR_TEST),n.scissor(a.x,a.y,a.width,a.height)),n.drawArrays(n.TRIANGLES,0,3),a&&n.disable(n.SCISSOR_TEST),e.blend&&n.disable(n.BLEND),this.onDraw?.()}dispose(){this.paintPlan.clear(),this.releaseSurfaces();for(let e of this.transfers.values())this.gl.deleteTexture(e);this.transfers.clear(),this.gl.deleteTexture(this.zero),this.gl.deleteTexture(this.one),this.gl.deleteVertexArray(this.vao),this.gl.deleteProgram(this.program)}constant(e){let t=this.gl,n=t.createTexture();return this.stage(n),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MIN_FILTER,t.NEAREST),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MAG_FILTER,t.NEAREST),t.texImage2D(t.TEXTURE_2D,0,t.RGBA8,1,1,0,t.RGBA,t.UNSIGNED_BYTE,e),n}bind(e,t){this.bound[e]!==t&&(this.bound[e]=t,this.gl.activeTexture(this.gl.TEXTURE0+this.firstUnit+e),this.gl.bindTexture(this.gl.TEXTURE_2D,t))}stage(e){this.bind(Ur,e)}target(e){this.gl.bindFramebuffer(this.gl.FRAMEBUFFER,e.framebuffer),this.gl.viewport(0,0,this.width,this.height)}releaseSurfaces(){for(let e of this.all)this.gl.deleteTexture(e.texture),this.gl.deleteFramebuffer(e.framebuffer);this.pool.length=0,this.all.clear()}transferTexture(e){let t=this.transfers.get(e);if(t)return t;let n=this.gl;t=n.createTexture(),this.stage(t),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_MIN_FILTER,n.NEAREST),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_MAG_FILTER,n.NEAREST);let r=Math.min(e.length,n.getParameter(n.MAX_TEXTURE_SIZE)),i=Math.ceil(e.length/r),a=new Float32Array(r*i);return a.set(e),n.texImage2D(n.TEXTURE_2D,0,n.R32F,r,i,0,n.RED,n.FLOAT,a),this.transfers.set(e,t),t}shader(e,t){let n=this.gl,r=n.createShader(e);if(n.shaderSource(r,t),n.compileShader(r),!n.getShaderParameter(r,n.COMPILE_STATUS)){let e=n.getShaderInfoLog(r);throw n.deleteShader(r),Error(`PDF compositor shader: ${e}`)}return r}};function Kr(e){if(!e)return[1,0,0,0,0];if(e.subtype!==`Luminosity`)return[0,0,0,1,0];let[t,n,r]=e.backdrop??[0,0,0],i=.3*t+.59*n+.11*r;return[.3,.59,.11,-i,i]}const qr=(l+p).replace(/heprGradient/g,`heprFoldGradient`);(r+u).replace(/heprGradient/g,`heprFoldGradient`);function Jr(e,t=!1){let n=/void\s+main\s*\(\s*\)/;if(!n.test(e))throw Error(`Folded paint shader has no main function.`);let r=Array.from({length:8},(e,t)=>`  coverage *= clamp(0.5 + dot(uPaintMaskGradient[${7+t}].xyz, p), 0.0, 1.0);`).join(`
`);return e.replace(n,`void heprUnfoldedPaint()`)+`
uniform vec4 uPaintFold;
uniform vec4 uPaintMaskWeights;
uniform vec4 uPaintMaskGradient[15];
uniform highp sampler2D uPaintMask;
${qr}
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
`}`${Array.from({length:15},(e,t)=>`d${t}: vec4f`).join(`, `)}${Array.from({length:8},(e,t)=>`    coverage *= clamp(0.5 + dot(d${7+t}.xyz, p), 0.0, 1.0);`).join(`
`)}`;function Yr(e){return!e.includes(`gl_Position`)&&!e.includes(`outColor`)||e.includes(`uPdfShapeOnly`)?e:(e=e.replace(/precision highp float;/,`precision highp float;
uniform float uPdfShapeOnly;
`),e.includes(`gl_Position`)?e.replace(/alpha <= 0\.001/g,`(alpha <= 0.001 && uPdfShapeOnly < 0.5)`).replace(/instanceC\.w <= 0\.001/g,`(instanceC.w <= 0.001 && uPdfShapeOnly < 0.5)`):e.replace(/\bvAlpha\b(?!\s*;)/g,`mix(vAlpha, 1.0, uPdfShapeOnly)`).replace(/\bvColorAlpha\b(?!\s*;)/g,`mix(vColorAlpha, 1.0, uPdfShapeOnly)`).replace(/\* uRasterOpacity/g,`* mix(uRasterOpacity, 1.0, uPdfShapeOnly)`).replace(/\* maskAlpha/g,`* mix(maskAlpha, 1.0, uPdfShapeOnly)`))}const Xr=/* @__PURE__ */ new WeakMap;function Zr(e){let t=e.drawRuns;if(!t)return null;let n=/* @__PURE__ */ new Map;t.forEach((e,t)=>{let r=n.get(e.kind);r?r.push(t):n.set(e.kind,[t])});let r=/* @__PURE__ */ new Map;for(let[e,i]of n)i.sort((e,n)=>t[e].first-t[n].first),r.set(e,{firsts:Int32Array.from(i,e=>t[e].first),ends:Int32Array.from(i,e=>t[e].first+t[e].count),indices:Int32Array.from(i)});return r}function Qr(e,t,n){let r=e?.get(t);if(!r)return-1;let i=0,a=r.firsts.length-1,o=-1;for(;i<=a;){let e=i+a>>1;r.firsts[e]<=n?(o=e,i=e+1):a=e-1}return o<0||n>=r.ends[o]?-1:o}function $r(e,t,n,r,i){let a;if(t&&n&&t.spanOrdered){a=Xr.get(t),(!a||a.coverageRevision!==t.coverageRevision||a.segments!==n||a.lookup!==r)&&(a={coverageRevision:t.coverageRevision,segments:n,lookup:r,ranges:/* @__PURE__ */ new WeakMap},Xr.set(t,a));let o=a.ranges.get(e);if(o!==void 0){if(o){o.revision!==t.revision&&ei(o,t);for(let e=o.first;e<o.end;e++)i(t.batches[e])}else for(let t of e)i(t);return}}let o=1/0,s=-1/0;if(t&&n&&t.spanOrdered){let i=/* @__PURE__ */ new Set,a=!0;for(let c of e){let e=r?.get(c.kind),l=Qr(r,c.kind,c.first),u=c.first,d=u+c.count;for(;e&&l>=0&&u<d;){let r=e.indices[l];if(e.firsts[l]!==u||e.ends[l]>d||!t.scheduledRuns[r]||i.has(r))break;i.add(r),o=Math.min(o,n[r]),s=Math.max(s,n[r]),u=e.ends[l++]}if(u!==d){a=!1;break}}(!a||i.size!==t.scheduledSpanRunCount(o,s))&&(o=1/0,s=-1/0)}if(!t||o>s){a?.ranges.set(e,null);for(let t of e)i(t);return}let c={low:o,high:s,revision:t.revision,first:0,end:0};ei(c,t),a?.ranges.set(e,c);for(let e=c.first;e<c.end;e++)i(t.batches[e])}function ei(e,t){let n=t.batchSegments,r=0,i=n.length-1;for(;r<=i;){let t=r+i>>1;n[t]<e.low?r=t+1:i=t-1}for(e.first=r,i=n.length-1;r<=i;){let t=r+i>>1;n[t]<=e.high?r=t+1:i=t-1}e.end=r,e.revision=t.revision}const ti=/* @__PURE__ */ `cameraCenterX.cameraCenterY.zoom.viewportWidth.viewportHeight.unitsPerPixel.schedulePadding.frameGapMs.cameraPositionX.cameraPositionY.cameraPositionZ.cameraQuaternionX.cameraQuaternionY.cameraQuaternionZ.cameraQuaternionW.cameraUpX.cameraUpY.cameraUpZ.cameraTargetX.cameraTargetY.cameraTargetZ.cameraDistanceToTarget.cameraTiltDegrees.cameraFovYDegrees.cameraAspect.cameraNear.cameraFar.cameraZoom.controlsChanged`.split(`.`),ni=[`Transition timings include work between frames. Asynchronous preparation spans include worker/queue wait; nested spans overlap. Events retain the latest 120 transitions and summaries up to 256 samples per name.`,`CPU times cover JavaScript and command submission, excluding asynchronous GPU execution.`,`Frame intervals describe rendered frames, not a continuous FPS benchmark; gaps over 250 ms are omitted.`,`GPU times sample every fourth rendered frame without waiting; unresolved or invalid samples are discarded.`,`GPU timers measure the command-stream span, including possible gaps during CPU preparation, not pure GPU busy time. CPU and GPU measurements overlap and must not be added.`,`Section and counter summaries include zero for completed frames in which that metric was absent.`,`Nested CPU sections overlap; do not add parent, child, and GL-call timings. Slow GL calls include driver waits, not just GPU execution.`,`Frame context frameGapMs preserves gaps omitted from interval summaries. Events retain up to eight longest instrumented calls per frame.`,`Frame records are a bounded subset of slow CPU/GPU, high-batch and timeline frames; their selection is not a representative performance distribution.`,`GPU operation timings put each draw, clear and blit between its own timer queries, so the GPU cannot overlap it with neighbours; their sum can exceed an untimed span. A sum far below the frame span means the GPU spent that time waiting for commands.`,`Source identifiers at an operation position describe its first sampled draw; visibility and scheduling can change them on later frames.`,`Geometry area estimates are omitted unless geometryDiagnostics is enabled; their per-instance scans add CPU work to captured frames.`];var ri=class{transitions=[];transitionSamples=/* @__PURE__ */ new Map;gl;now;active=!1;disposed=!1;maxFrames=600;maxFrameRecords=120;captureGeometryDiagnostics=!1;startedAt=0;endedAt=0;frameStart=null;previousFrame=null;frameInterval=null;frameContext=null;ignoredFrameGaps=0;discardedMetricNames=0;frameIntervals=[];frameCpu=[];frameStarts=[];recordedIntervals=[];frameContexts=[];frameEvents=[];events=[];frameGpuTimes=[];frameGpuStates=[];cpuSections=/* @__PURE__ */ new Map;counters=/* @__PURE__ */ new Map;openSections=/* @__PURE__ */ new Map;sectionTotals=/* @__PURE__ */ new Map;counterTotals=/* @__PURE__ */ new Map;extension=null;gpuStatus=`disabled`;gpuReason=null;activeQuery=null;pendingQueries=[];gpuTimes=[];droppedGpuSamples=0;describeProgram;describeDraw;operations=null;gpuTimer;externalOperations=null;externalTiming=!1;constructor(e={}){this.gl=e.gl,this.now=e.now??(()=>performance.now()),this.describeProgram=e.describeProgram,this.describeDraw=e.describeDraw,this.gpuTimer=e.gpuTimer}get enabled(){return this.active}get geometryDiagnostics(){return this.active&&this.captureGeometryDiagnostics}start(e={}){if(this.disposed)throw Error(`Render performance profiler is disposed.`);let t=e.maxFrames??600,n=e.maxFrameRecords??120;if(!Number.isInteger(t)||t<1||t>1e4)throw RangeError(`maxFrames must be an integer from 1 to 10000.`);if(!Number.isInteger(n)||n<0||n>1e3)throw RangeError(`maxFrameRecords must be an integer from 0 to 1000.`);if(e.gpu!==void 0&&typeof e.gpu!=`boolean`)throw TypeError(`gpu must be a boolean.`);if(e.gpuOperations!==void 0&&typeof e.gpuOperations!=`boolean`)throw TypeError(`gpuOperations must be a boolean.`);if(e.geometryDiagnostics!==void 0&&typeof e.geometryDiagnostics!=`boolean`)throw TypeError(`geometryDiagnostics must be a boolean.`);if(e.gpuOperations&&e.gpu===!1)throw TypeError(`gpuOperations requires gpu timing.`);if(this.reset(),this.maxFrames=t,this.maxFrameRecords=n,this.captureGeometryDiagnostics=e.geometryDiagnostics??!1,this.startedAt=this.now(),this.endedAt=this.startedAt,this.active=!0,e.gpu!==!1){if(this.gpuTimer){let t=this.gpuTimer.unavailableReason;this.gpuStatus=t?`unavailable`:`available`,this.gpuReason=t,!t&&e.gpuOperations&&(this.externalOperations=new si);return}if(!this.gl){this.gpuStatus=`unavailable`,this.gpuReason=`No WebGL2 context was provided.`;return}try{this.extension=this.gl.getExtension(`EXT_disjoint_timer_query_webgl2`),this.gpuStatus=this.extension?`available`:`unavailable`,this.gpuReason=this.extension?null:`EXT_disjoint_timer_query_webgl2 is unavailable.`,this.extension&&e.gpuOperations&&(this.operations=new ci(this.gl,this.extension,this.describeProgram,this.describeDraw))}catch{this.gpuStatus=`unavailable`,this.gpuReason=`The WebGL timer-query extension could not be initialized.`}}}beginFrame(e){if(!this.active||this.frameStart!==null)return;let t=this.now(),n=e!==void 0&&Number.isFinite(e)?e:t;this.frameInterval=null;let r=this.previousFrame===null?null:n-this.previousFrame;if(this.previousFrame!==null){let e=n-this.previousFrame;e>250?this.ignoredFrameGaps++:e>0&&(this.frameIntervals.push(e),this.frameInterval=e)}if(this.previousFrame=n,this.frameStart=t,this.frameContext=this.maxFrameRecords?{frameGapMs:r!==null&&r>0?r:null}:null,this.events=[],this.pollGpu(),this.gpuTimer){if(this.gpuStatus!==`available`||this.frameCpu.length%4!=0)return;let e=this.frameCpu.length;this.externalTiming=this.gpuTimer.beginFrame(e),this.externalTiming||this.droppedGpuSamples++,this.maxFrameRecords&&(this.frameGpuStates[e]=this.externalTiming?`pending`:`discarded`);return}if(this.gpuStatus===`available`&&this.operations?.beginFrame(this.frameCpu.length),this.gpuStatus!==`available`||this.frameCpu.length%4!=0)return;if(this.maxFrameRecords&&(this.frameGpuStates[this.frameCpu.length]=`discarded`),this.pendingQueries.length>=8){this.droppedGpuSamples++;return}let i=this.gl,a=this.extension;try{if(i.getQuery(a.TIME_ELAPSED_EXT,i.CURRENT_QUERY)){this.droppedGpuSamples++;return}let e=i.createQuery();if(!e){this.droppedGpuSamples++;return}this.activeQuery={query:e,frame:this.frameCpu.length},i.beginQuery(a.TIME_ELAPSED_EXT,e),this.maxFrameRecords&&(this.frameGpuStates[this.frameCpu.length]=`pending`)}catch{this.disableGpu(`A WebGL timer query could not be started.`)}}endFrame(){if(!this.active||this.frameStart===null)return;let e=this.now();for(let[t,n]of this.openSections)this.sectionTotals.set(t,(this.sectionTotals.get(t)??0)+Math.max(0,e-n));this.openSections.clear(),this.recordMetrics(this.cpuSections,this.sectionTotals),this.recordMetrics(this.counters,this.counterTotals),this.maxFrameRecords&&(this.frameStarts.push(Math.max(0,this.frameStart-this.startedAt)),this.recordedIntervals.push(this.frameInterval),this.frameContexts.push(this.frameContext??{}),this.frameEvents.push(this.events)),this.frameCpu.push(Math.max(0,e-this.frameStart)),this.frameStart=null,this.endedAt=e,this.operations?.endFrame(),this.externalTiming&&(this.externalTiming=!1,this.gpuTimer.endFrame()),this.finishGpuQuery(),this.frameCpu.length>=this.maxFrames&&this.finish()}beginSection(e){this.active&&this.frameStart!==null&&!this.openSections.has(e)&&this.ensureMetric(this.cpuSections,e)&&this.openSections.set(e,this.now())}endSection(e){if(!this.active||this.frameStart===null)return;let t=this.openSections.get(e);t!==void 0&&(this.openSections.delete(e),this.sectionTotals.set(e,(this.sectionTotals.get(e)??0)+Math.max(0,this.now()-t)))}addSectionTime(e,t){!this.active||this.frameStart===null||!Number.isFinite(t)||t<0||this.ensureMetric(this.cpuSections,e)&&this.sectionTotals.set(e,(this.sectionTotals.get(e)??0)+t)}recordEvent(e,t){!this.active||this.frameStart===null||!this.maxFrameRecords||!Number.isFinite(t)||t<0||this.events.length===8&&t<=this.events[7].durationMs||(this.events.push({name:e.slice(0,96),durationMs:t}),this.events.sort((e,t)=>t.durationMs-e.durationMs),this.events.length>8&&(this.events.length=8))}add(e,t=1){this.active&&this.frameStart!==null&&Number.isFinite(t)&&this.ensureMetric(this.counters,e)&&this.counterTotals.set(e,(this.counterTotals.get(e)??0)+t)}setFrameContext(e){if(this.active&&this.frameStart!==null&&this.maxFrameRecords){this.frameContext??={};for(let t of ti){let n=e[t];(n===null||typeof n==`number`&&Number.isFinite(n))&&(this.frameContext[t]=n)}}}stop(){return this.finish(),this.getReport()}recordTransition(e,t){if(!this.active||!Number.isFinite(t)||t<0||!e||e.length>128)return;let n=this.transitionSamples.get(e);if(!n){if(this.transitionSamples.size>=64)return;this.transitionSamples.set(e,n=[])}n.length<256&&n.push(t),this.transitions.push({name:e,durationMs:t,startMs:Math.max(0,this.now()-this.startedAt-t)}),this.transitions.length>120&&this.transitions.shift()}reset(){this.finish(),this.startedAt=this.endedAt=0,this.previousFrame=null,this.frameInterval=null,this.frameContext=null,this.captureGeometryDiagnostics=!1,this.ignoredFrameGaps=this.discardedMetricNames=this.droppedGpuSamples=0,this.frameIntervals.length=this.frameCpu.length=this.gpuTimes.length=0,this.frameStarts.length=this.recordedIntervals.length=this.frameContexts.length=this.frameEvents.length=0,this.events=[],this.frameGpuTimes.length=this.frameGpuStates.length=0,this.cpuSections.clear(),this.counters.clear(),this.transitions.length=0,this.transitionSamples.clear(),this.operations=null,this.externalOperations=null,this.externalTiming=!1,this.extension=null,this.gpuStatus=`disabled`,this.gpuReason=null}getReport(){return{active:this.active,frames:this.frameCpu.length,maxFrames:this.maxFrames,geometryDiagnostics:this.captureGeometryDiagnostics,transitions:this.transitions.map(e=>({...e})),transitionSections:Object.fromEntries([...this.transitionSamples].map(([e,t])=>[e,H(t)])),elapsedMs:Math.max(0,(this.active?this.now():this.endedAt)-this.startedAt),frameIntervalMs:H(this.frameIntervals),frameCpuMs:H(this.frameCpu),cpuSections:Object.fromEntries([...this.cpuSections].map(([e,t])=>[e,H(t)])),counters:Object.fromEntries([...this.counters].map(([e,t])=>[e,H(t)])),frameRecords:this.getFrameRecords(),frameRecordLimit:this.maxFrameRecords,ignoredFrameGaps:this.ignoredFrameGaps,discardedMetricNames:this.discardedMetricNames,gpu:{status:this.gpuStatus,reason:this.gpuReason,frameMs:H(this.gpuTimes),pendingSamples:this.pendingQueries.length+ +!!this.activeQuery,droppedSamples:this.droppedGpuSamples,sampleEvery:4,operations:this.operationReport()},notes:this.gpuTimer?.note?[...ni,this.gpuTimer.note]:[...ni]}}dispose(){this.finish(),this.disposed=!0}operationReport(){if(this.externalOperations){let{frameMs:e,frameOperations:t,...n}=this.externalOperations.totals();return{status:this.gpuStatus===`available`?`available`:`unavailable`,reason:this.gpuReason,sampleEvery:4,droppedFrames:0,...n,frameMs:H(e),operationsPerFrame:H(t)}}if(!this.operations)return null;let{frameMs:e,frameOperations:t,...n}=this.operations.totals();return{...n,frameMs:H(e),operationsPerFrame:H(t)}}ensureMetric(e,t){return e.has(t)?!0:e.size>=64?(this.discardedMetricNames++,!1):(e.set(t,Array(this.frameCpu.length).fill(0)),!0)}recordMetrics(e,t){for(let[n,r]of e)r.push(t.get(n)??0);t.clear()}getFrameRecords(){let e=this.frameCpu.length,t=Math.min(this.maxFrameRecords,e);if(!t)return[];let n=/* @__PURE__ */ new Map,r=(e,r)=>{let i=n.get(e);if(!i){if(n.size>=t)return;i=/* @__PURE__ */ new Set,n.set(e,i)}i.add(r)},i=Math.max(1,Math.floor(t/4)),a=(t,n)=>{let a=[];for(let n=0;n<e;n++)(t[n]??0)>0&&a.push(n);a.sort((e,n)=>t[n]-t[e]||e-n);for(let e=0;e<Math.min(i,a.length);e++)r(a[e],n)};a(this.frameCpu,`slow-cpu`),a(this.frameGpuTimes,`slow-gpu`);let o=this.counters.get(`drawBatches`)??this.counters.get(`drawCalls`);if(!o){o=Array(e).fill(0);for(let[t,n]of this.counters)if(t.endsWith(`Batches`))for(let t=0;t<e;t++)o[t]+=n[t]??0}a(o,`high-batches`);let s=[...n.keys()].filter(e=>this.frameCpu[e]>=100).sort((e,t)=>this.frameCpu[t]-this.frameCpu[e]);for(let t of s)t>0&&r(t-1,`stall-neighbour`),t+1<e&&r(t+1,`stall-neighbour`);r(0,`timeline`),r(e-1,`timeline`);for(let i=2;n.size<t&&i<e*2;i*=2)for(let a=1;a<i&&n.size<t;a+=2)r(Math.round(a*(e-1)/i),`timeline`);for(let i=0;n.size<t&&i<e;i++)r(i,`timeline`);return[...n].sort(([e],[t])=>e-t).map(([e,t])=>({frame:e+1,startMs:this.frameStarts[e],intervalMs:this.recordedIntervals[e],cpuMs:this.frameCpu[e],gpuMs:this.frameGpuTimes[e]??null,gpuStatus:this.frameGpuStates[e]??`not-sampled`,context:{...this.frameContexts[e]},cpuSectionsMs:Object.fromEntries([...this.cpuSections].map(([t,n])=>[t,n[e]??0])),counters:Object.fromEntries([...this.counters].map(([t,n])=>[t,n[e]??0])),reasons:[...t],events:this.frameEvents[e].map(e=>({...e}))}))}finish(){if(this.active){if(this.endedAt=this.now(),this.finishGpuQuery(),this.pollGpu(),this.gpuTimer){this.externalTiming&&(this.externalTiming=!1,this.gpuTimer.endFrame()),this.droppedGpuSamples+=this.gpuTimer.cancel();for(let e=0;e<this.frameGpuStates.length;e++)this.frameGpuStates[e]===`pending`&&this.discardFrameGpu(e)}this.releaseQueries(),this.operations?.dispose(),this.active=!1,this.frameStart=null,this.openSections.clear(),this.sectionTotals.clear(),this.counterTotals.clear()}}finishGpuQuery(){if(!this.activeQuery)return;let e=this.activeQuery;this.activeQuery=null;try{this.gl.endQuery(this.extension.TIME_ELAPSED_EXT),this.pendingQueries.push(e)}catch{try{this.gl.deleteQuery(e.query)}catch{}this.discardFrameGpu(e.frame),this.droppedGpuSamples++,this.disableGpu(`A WebGL timer query could not be completed.`)}}pollGpu(){if(this.gpuStatus!==`available`)return;if(this.gpuTimer){for(let e of this.gpuTimer.takeResults()){if(e.ms===null||!Number.isFinite(e.ms)||e.ms<0){this.droppedGpuSamples++,this.discardFrameGpu(e.frame);continue}this.gpuTimes.push(e.ms),this.maxFrameRecords&&(this.frameGpuTimes[e.frame]=e.ms,this.frameGpuStates[e.frame]=`available`),e.operations&&this.externalOperations&&this.externalOperations.addFrame(e.operations)}return}let e=this.gl;try{if(e.getParameter(this.extension.GPU_DISJOINT_EXT)){this.gpuStatus=`disjoint`,this.gpuReason=`GPU clock disjoint detected; GPU timings were discarded for this capture.`,this.operations?.discardPending(),this.droppedGpuSamples+=this.gpuTimes.length,this.gpuTimes.length=0;for(let e=0;e<this.frameGpuStates.length;e++)this.frameGpuStates[e]===`available`&&this.discardFrameGpu(e);this.releaseQueries();return}for(;this.pendingQueries.length;){let t=this.pendingQueries[0],n=t.query;if(!e.getQueryParameter(n,e.QUERY_RESULT_AVAILABLE))break;let r=Number(e.getQueryParameter(n,e.QUERY_RESULT));if(this.pendingQueries.shift(),e.deleteQuery(n),Number.isFinite(r)&&r>=0){let e=r/1e6;this.gpuTimes.push(e),this.maxFrameRecords&&(this.frameGpuTimes[t.frame]=e,this.frameGpuStates[t.frame]=`available`)}else this.droppedGpuSamples++,this.discardFrameGpu(t.frame)}this.operations?.poll()}catch{this.disableGpu(`WebGL timer-query results could not be read.`)}}disableGpu(e){this.gpuStatus=`unavailable`,this.gpuReason=e,this.releaseQueries()}releaseQueries(){if(this.activeQuery){try{this.gl.endQuery(this.extension.TIME_ELAPSED_EXT)}catch{}this.pendingQueries.push(this.activeQuery),this.activeQuery=null}for(let e of this.pendingQueries){try{this.gl.deleteQuery(e.query)}catch{}this.discardFrameGpu(e.frame),this.droppedGpuSamples++}this.pendingQueries.length=0}discardFrameGpu(e){this.maxFrameRecords&&(this.frameGpuTimes[e]=null,this.frameGpuStates[e]=`discarded`)}};function H(e){if(!e.length)return{samples:0,total:0,average:null,p50:null,p95:null,min:null,max:null};let t=[...e].sort((e,t)=>e-t),n=e.reduce((e,t)=>e+t,0),r=e=>{let n=(t.length-1)*e,r=Math.floor(n);return t[r]+(t[Math.ceil(n)]-t[r])*(n-r)};return{samples:e.length,total:n,average:n/e.length,p50:r(.5),p95:r(.95),min:t[0],max:t[t.length-1]}}function ii(e){return H(e).p50??0}const ai=4096,oi={drawArrays:e=>[e[2],1],drawArraysInstanced:e=>[e[2],e[3]],drawElements:e=>[e[1],1],drawElementsInstanced:e=>[e[1],e[4]],clear:()=>[null,null],blitFramebuffer:()=>[null,null]};var si=class{frameMs=[];frameOperations=[];labels=/* @__PURE__ */ new Map;positions=/* @__PURE__ */ new Map;slowest=[];get frames(){return this.frameMs.length}addFrame(e){let t=this.frameMs.length,n=0;for(let r of e){let e=r.ms;n+=e;let i=this.labels.get(r.label);for(i||this.labels.set(r.label,i={calls:0,ms:0,maxMs:0,frameMs:[]}),i.calls++,i.ms+=e,i.maxMs=Math.max(i.maxMs,e);i.frameMs.length<=t;)i.frameMs.push(0);i.frameMs[t]+=e;let a=`${r.order}:${r.label}`,o=this.positions.get(a);o?o.ms.push(e):this.positions.size<ai&&this.positions.set(a,{detail:{...r},ms:[e]}),(this.slowest.length<16||e>this.slowest[this.slowest.length-1].ms)&&(this.slowest.push({...r}),this.slowest.sort((e,t)=>t.ms-e.ms),this.slowest.length=Math.min(this.slowest.length,16))}this.frameMs.push(n),this.frameOperations.push(e.length)}totals(){let e=Math.max(1,this.frameMs.length),t=e=>({...e,viewport:[...e.viewport],scissor:e.scissor?[...e.scissor]:null,...e.source?{source:{...e.source,ids:[...e.source.ids],clips:[...e.source.clips],...e.source.kinds?{kinds:[...e.source.kinds]}:{}}}:{}}),n=[...this.labels].map(([t,n])=>{let r=[...n.frameMs];for(;r.length<this.frameMs.length;)r.push(0);return{label:t,operationsPerFrame:n.calls/e,msPerFrame:n.ms/e,medianMsPerFrame:ii(r),maxMs:n.maxMs}}).sort((e,t)=>t.medianMsPerFrame-e.medianMsPerFrame||t.msPerFrame-e.msPerFrame),r=[...this.positions.values()].filter(e=>e.ms.length*2>=this.frameMs.length),i=r.map(e=>({...t(e.detail),ms:ii(e.ms),frames:e.ms.length})).sort((e,t)=>t.ms-e.ms||e.order-t.order).slice(0,16),a=r.map(({detail:e,ms:n})=>({order:e.order,label:e.label,instances:e.instances,ms:ii(n),...e.source?{source:t(e).source}:{}})).sort((e,t)=>e.order-t.order||e.label.localeCompare(t.label));return{frameMs:[...this.frameMs],frameOperations:[...this.frameOperations],byLabel:n,slowest:this.slowest.map(t),typical:i,byPosition:a}}},ci=class{gl;extension;describe;describeDraw;restores=[];ordinals=/* @__PURE__ */ new Map;installed=!0;timing=!1;program=null;offscreen=!1;viewportSize=[0,0];scissorEnabled=!1;scissorBox=[0,0,0,0];frame=[];pending=[];stats=new si;droppedFrames=0;status=`available`;reason=null;constructor(e,t,n=()=>null,r){this.gl=e,this.extension=t,this.describe=n,this.describeDraw=r;try{this.program=e.getParameter(e.CURRENT_PROGRAM),this.offscreen=e.getParameter(e.DRAW_FRAMEBUFFER_BINDING)!==null;let t=e.getParameter(e.VIEWPORT);t&&(this.viewportSize=[t[2],t[3]]);let n=e.getParameter(e.SCISSOR_BOX);n&&(this.scissorBox=[n[0],n[1],n[2],n[3]]),this.scissorEnabled=e.isEnabled(e.SCISSOR_TEST)}catch{}this.install()}beginFrame(e){if(this.timing=!1,this.installed&&this.status===`available`&&e%8==2){if(this.pending.length>=2){this.droppedFrames++;return}try{if(this.gl.getQuery(this.extension.TIME_ELAPSED_EXT,this.gl.CURRENT_QUERY)){this.droppedFrames++;return}}catch{this.disable(`WebGL timer queries could not be inspected.`);return}this.timing=!0}}endFrame(){this.timing&&this.frame.length&&this.pending.push(this.frame),this.frame=[],this.timing=!1}poll(){let e=this.gl;try{for(;this.pending.length;){let t=this.pending[0];if(!e.getQueryParameter(t[t.length-1].query,e.QUERY_RESULT_AVAILABLE))return;this.pending.shift();let n=!0,r=t.map(t=>{let r=Number(e.getQueryParameter(t.query,e.QUERY_RESULT));return e.deleteQuery(t.query),(!Number.isFinite(r)||r<0)&&(n=!1),r/1e6});if(!n){this.droppedFrames++;continue}this.stats.addFrame(t.map(({query:e,...t},n)=>({...t,ms:r[n]})))}}catch{this.disable(`WebGL timer-query results could not be read.`)}}discardPending(){this.droppedFrames+=this.pending.length,this.release(),this.status=`disjoint`,this.reason=`GPU clock disjoint detected; operation timings in flight were discarded.`}totals(){return{status:this.status,reason:this.reason,sampleEvery:8,droppedFrames:this.droppedFrames,...this.stats.totals()}}dispose(){this.endFrame(),this.release(),this.installed=!1;for(let e of this.restores)e();this.restores.length=0}label(e){if(e===`clear`||e===`blitFramebuffer`)return`${e===`clear`?`clear`:`blit`} → ${this.offscreen?`offscreen`:`screen`}`;let t=this.describe(this.program);if(!t){if(!this.program)t=`no program`;else{let e=this.ordinals.get(this.program);e===void 0&&this.ordinals.set(this.program,e=this.ordinals.size+1),t=`program#${e}`}}return`${t} → ${this.offscreen?`offscreen`:`screen`}`}install(){let e=this.gl,t=e,n=(n,i)=>{let a=t[n];if(typeof a!=`function`)return;let o=Object.getOwnPropertyDescriptor(t,n),s=i((...t)=>Reflect.apply(a,e,t)),c=function(...e){return r.installed?s(...e):Reflect.apply(a,this,e)};try{Object.defineProperty(t,n,{configurable:!0,writable:!0,value:c}),this.restores.push(()=>{t[n]===c&&(o?Object.defineProperty(t,n,o):delete t[n])})}catch{}},r=this;n(`useProgram`,e=>(...t)=>(r.program=t[0],e(...t))),n(`bindFramebuffer`,t=>(...n)=>((n[0]===e.FRAMEBUFFER||n[0]===e.DRAW_FRAMEBUFFER)&&(r.offscreen=n[1]!==null),t(...n))),n(`viewport`,e=>(...t)=>(r.viewportSize=[t[2],t[3]],e(...t))),n(`scissor`,e=>(...t)=>(r.scissorBox=[t[0],t[1],t[2],t[3]],e(...t)));for(let t of[`enable`,`disable`])n(t,n=>(...i)=>(i[0]===e.SCISSOR_TEST&&(r.scissorEnabled=t===`enable`),n(...i)));for(let[t,i]of Object.entries(oi))n(t,n=>(...a)=>{if(!r.timing||r.frame.length>=ai)return n(...a);let o=null;try{o=e.createQuery(),o&&e.beginQuery(r.extension.TIME_ELAPSED_EXT,o)}catch{r.disable(`A WebGL timer query could not be started.`),o=null}try{return n(...a)}finally{if(o)try{e.endQuery(r.extension.TIME_ELAPSED_EXT);let[n,s]=i(a),c=t===`blitFramebuffer`?Math.abs(a[6]-a[4])*Math.abs(a[7]-a[5]):null,l=t.startsWith(`draw`)?r.describeDraw?.(r.program,s??0):void 0;r.frame.push({query:o,label:r.label(t),order:r.frame.length,call:t,vertices:n,instances:s,pixels:c,target:r.offscreen?`offscreen`:`screen`,viewport:[...r.viewportSize],scissor:r.scissorEnabled?[...r.scissorBox]:null,...l?{source:l}:{}})}catch{r.disable(`A WebGL timer query could not be completed.`)}}})}disable(e){this.timing=!1,this.release(),this.status=`unavailable`,this.reason=e}release(){for(let e of[...this.frame,...this.pending.flat()])try{this.gl.deleteQuery(e.query)}catch{}this.frame=[],this.pending.length=0}};function li(e,t,n){let r=1e-6;for(let i of[n.minX,n.maxX])for(let a of[n.minY,n.maxY]){let n=e[3]*i+e[7]*a+e[15];if(n<=1e-10)continue;let o=e[0]*i+e[4]*a+e[12],s=e[1]*i+e[5]*a+e[13],c=(e[0]*n-o*e[3])/(n*n)*t.width*.5,l=(e[4]*n-o*e[7])/(n*n)*t.width*.5,u=(e[1]*n-s*e[3])/(n*n)*t.height*.5,d=(e[5]*n-s*e[7])/(n*n)*t.height*.5,f=c*c+l*l+u*u+d*d,p=c*d-l*u,m=(f+Math.sqrt(Math.max(0,f*f-4*p*p)))*.5,h=Math.sqrt(m)/Math.max(1e-12,Math.abs(p));Number.isFinite(h)&&(r=Math.max(r,h))}return r}const ui=[`stroke`,`fill`,`text`,`raster`,`gradient-fill`,`gradient-stroke`];function di(e){return[e.segmentCount,e.fillPathCount,e.textInstanceCount,e.rasterLayers.length,e.gradientFillPathCount,e.gradientStrokeRunCount]}function fi(e,t){let n=t?ui.indexOf(t.kind):-1;if(n<0||!Number.isSafeInteger(t.index)||t.index<0||t.index>=di(e)[n])throw RangeError(`Primitive reference is outside the loaded scene.`)}const pi=[.15,.45,1],mi=[1,.65,.05];function hi(e){return`${e.kind}:${e.index}`}function gi(e,t){let n=/* @__PURE__ */ new Map;for(let t of e){let e=n.get(t.kind);e||n.set(t.kind,e=/* @__PURE__ */ new Map),e.set(t.index,t)}let r=[];for(let[e,i]of n){let n=[...i.values()].sort((e,t)=>e.index-t.index),a=t[e];for(let t=0;t<n.length;){let i=n[t],o=Math.floor(i.index/a),s=t+1;for(;s<n.length&&n[s].index===n[s-1].index+1&&Math.floor(n[s].index/a)===o;)s++;let c=s-t,l=c===1?i.pixels:i.pixels instanceof Uint8Array?new Uint8Array(c*4):new Float32Array(c*4);if(c>1)for(let e=t;e<s;e++)l.set(n[e].pixels,(e-t)*4);r.push({kind:e,index:i.index,count:c,pixels:l}),t=s}}return r}var _i=class{colors=/* @__PURE__ */ new Map;scene;constructor(e){this.scene=e}update(e){for(let t of e){if(fi(this.scene,t.ref),t.ref.kind===`raster`)throw TypeError(`Raster primitives cannot be recolored.`);if(t.color&&(t.color.length!==3||!t.color.every(e=>Number.isFinite(e)&&e>=0&&e<=1)))throw TypeError(`Primitive colors must contain three normalized channels.`)}let t=e.flatMap(e=>vi(this.scene,e));for(let t of e)t.color?this.colors.set(hi(t.ref),{ref:{...t.ref},color:[...t.color]}):this.colors.delete(hi(t.ref));return t}updates(){return[...this.colors.values()]}has(e){for(let t of this.colors.values())if(t.ref.kind===e)return!0;return!1}gradient(e,t){return this.colors.get(`${e}:${t}`)?.color??null}};function vi(e,{ref:t,color:n}){let r=t.index*4;if(t.kind===`stroke`){let i=e.styles.slice(r,r+4);return n&&i.set(n,1),[{kind:`stroke`,index:t.index,pixels:i}]}if(t.kind===`fill`){let i=e.fillPathMetaB.slice(r,r+4),a=e.fillPathMetaC.slice(r,r+4);return n&&(i[2]=n[0],i[3]=n[1],a[2]=n[2]),[{kind:`fillB`,index:t.index,pixels:i},{kind:`fillC`,index:t.index,pixels:a}]}if(t.kind===`text`){let i=/* @__PURE__ */ new Uint8Array(4);for(let t=0;t<4;t++){let a=t<3&&n?n[t]:e.textInstanceC[r+t];i[t]=Math.round(Math.max(0,Math.min(1,a))*255)}return[{kind:`text`,index:t.index,pixels:i}]}return[]}const yi=`#version 300 es
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
  vColor = aHighlightIndex < uSelectionCount ? vec3(${pi.join(`,`)}) : vec3(${mi.join(`,`)});
  gl_Position = uLocalToClip * vec4(vLocal, 0.0, 1.0);
}
`,bi=`#version 300 es
precision highp float;
precision highp sampler2D;
uniform float uPixelRatio;
in vec2 vLocal;
flat in vec4 vSegmentA;
flat in vec4 vSegmentB;
flat in vec3 vColor;
out vec4 outColor;
${pn.replace(`int(uVectorClipIndex)`,`int(vSegmentB.w)`)}
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
`;`${mi.join(`,`)}${pi.join(`,`)}`;function xi(e,t){let n=o(e.clipPaths,Math.min(h,t**2)),r=Math.max(1,Math.min(t,Math.ceil(Math.sqrt(n.length/4)))),i=Math.max(1,Math.ceil(n.length/4/r));if(i>t)throw RangeError(`Primitive highlight clips exceed GPU limits.`);let a=new Float32Array(r*i*4);return a.set(n),{data:a,width:r,height:i}}var Si=class{program;buffer;vao;clips;uniforms={};count=0;selectionCount=0;matrix=/* @__PURE__ */ new Float32Array(16);capacityBytes=0;clipWidth=0;clipHeight=0;gl;constructor(e,t){this.gl=e,this.program=t(yi.replace(`layout(location=2) in float aHighlightIndex;`,``).replace(`aHighlightIndex <`,`float(gl_InstanceID) <`),bi);let n=e.createBuffer(),r=e.createVertexArray(),i=e.createTexture();if(!n||!r||!i)throw e.deleteBuffer(n),e.deleteVertexArray(r),e.deleteTexture(i),e.deleteProgram(this.program),Error(`Unable to allocate primitive highlight resources.`);this.buffer=n,this.vao=r,this.clips=i;for(let t of[`uLocalToClip`,`uLocalUnitsPerPixel`,`uPixelRatio`,`uSelectionCount`,`uVectorClipTex`])this.uniforms[t]=e.getUniformLocation(this.program,t);e.bindVertexArray(r),e.bindBuffer(e.ARRAY_BUFFER,n);for(let t=0;t<2;t++)e.enableVertexAttribArray(t),e.vertexAttribPointer(t,4,e.FLOAT,!1,32,t*16),e.vertexAttribDivisor(t,1);e.bindVertexArray(null)}set(e){if(this.count=e?.count??0,this.selectionCount=e?.selectionCount??0,!e||!this.count)return;let t=this.gl,n=xi(e,t.getParameter(t.MAX_TEXTURE_SIZE));t.bindBuffer(t.ARRAY_BUFFER,this.buffer),this.capacityBytes<this.count*32&&(this.capacityBytes=Math.max(this.count*32,this.capacityBytes*2,1024),t.bufferData(t.ARRAY_BUFFER,this.capacityBytes,t.DYNAMIC_DRAW)),t.bufferSubData(t.ARRAY_BUFFER,0,e.segments.subarray(0,this.count*8)),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,this.clips),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MIN_FILTER,t.NEAREST),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MAG_FILTER,t.NEAREST),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_S,t.CLAMP_TO_EDGE),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_T,t.CLAMP_TO_EDGE),this.clipWidth!==n.width||this.clipHeight!==n.height?(this.clipWidth=n.width,this.clipHeight=n.height,t.texImage2D(t.TEXTURE_2D,0,t.RGBA32F,n.width,n.height,0,t.RGBA,t.FLOAT,n.data)):t.texSubImage2D(t.TEXTURE_2D,0,0,0,n.width,n.height,t.RGBA,t.FLOAT,n.data)}draw(e,t,n){if(!this.count)return 0;let r=this.gl;return this.matrix.set(e),r.useProgram(this.program),r.uniformMatrix4fv(this.uniforms.uLocalToClip,!1,this.matrix),r.uniform1f(this.uniforms.uLocalUnitsPerPixel,t),r.uniform1f(this.uniforms.uPixelRatio,n),r.uniform1f(this.uniforms.uSelectionCount,this.selectionCount),r.activeTexture(r.TEXTURE0),r.bindTexture(r.TEXTURE_2D,this.clips),r.uniform1i(this.uniforms.uVectorClipTex,0),r.enable(r.BLEND),r.blendFuncSeparate(r.SRC_ALPHA,r.ONE_MINUS_SRC_ALPHA,r.ONE,r.ONE_MINUS_SRC_ALPHA),r.bindVertexArray(this.vao),r.drawArraysInstanced(r.TRIANGLE_STRIP,0,4,this.count),r.bindVertexArray(null),1}dispose(){this.gl.deleteProgram(this.program),this.gl.deleteBuffer(this.buffer),this.gl.deleteVertexArray(this.vao),this.gl.deleteTexture(this.clips)}};function Ci(e,t=!1){return e.replace(/void\s+main\s*\(\s*\)/,`void heprMultiplyPaint()`)+`
${t?`uniform bool uHeprMultiply;`:``}
void main() {
  heprMultiplyPaint();
  ${t?`if (uHeprMultiply) `:``}outColor.rgb *= outColor.a;
}
`}const wi=[`stroke`,`fill`,`text`,`raster`,`gradient-fill`,`gradient-stroke`];var Ti=class e{independentGroups=1;paintOrderApproximated=!1;bounds;pageForRun;kindForRun;colorForRun;components;pageBounds;paintBounds;heads;tails;next;ordered=[];compacted=[];colorGrouped=[];skipped=/* @__PURE__ */ new Int32Array(128);previousPaints;selectedPaints;allPaints;filtered=[];segmentRuns=[];segments;independentPages;paddingLimit;previousPaintCount=-1;scheduleDirty=!0;padding=NaN;enabled=!1;colorCommutationEnabled=!0;textLodData=null;static create(t,n,r,i=null,a=null){let o=(t.pageRects?.length??0)/4;return!t.drawRuns||o<1||o>65536||!Number.isInteger(o)||!t.pageRects.every(Number.isFinite)||o>512&&o*(t.drawRuns.length+o)>16777216||i&&i.length!==t.drawRuns.length||a&&(a.length!==t.drawRuns.length||a.some(e=>e>=o))?null:new e(t,n,r,i,a)}constructor(e,t,n,r,i){let a=e.drawRuns,o=e.pageRects.length/4;this.segments=r,this.independentPages=i!==null,this.bounds=new Te(e,{records:t,sourceRuns:n}),this.pageForRun=new Uint16Array(a.length),this.kindForRun=new Uint8Array(a.length),this.colorForRun=Ei(e,t,n),this.components=new Int32Array(o),this.pageBounds=new Float64Array(o*4),this.paintBounds=new Float64Array(a.length*4),this.heads=new Int32Array(o),this.tails=new Int32Array(o),this.next=new Int32Array(a.length),this.previousPaints=new Uint32Array(a.length),this.selectedPaints=new Uint8Array(a.length),this.allPaints=a.length>=1024?Array.from({length:a.length},(e,t)=>t):null;let s=0;for(let t=0;t<o;t++){let n=t*4,r=e.pageRects;s=Math.max(s,r[n+2]-r[n],r[n+3]-r[n+1])}this.paddingLimit=s>0&&a.length>=1024?4*s/256:1/0;let c=[0,0,0,0];a.forEach((t,n)=>{if(this.kindForRun[n]=wi.indexOf(t.kind),i){this.pageForRun[n]=i[n];return}this.bounds.getBounds(n,0,c);let r=(c[0]+c[2])*.5,a=(c[1]+c[3])*.5,s=0,l=1/0;for(let t=0;t<o;t++){let n=t*4,i=e.pageRects,o=Math.max(i[n]-r,0,r-i[n+2]),c=Math.max(i[n+1]-a,0,a-i[n+3]);o*o+c*c<l&&(s=t,l=o*o+c*c)}this.pageForRun[n]=s})}includeTextLod(e){this.textLodData!==e&&(this.textLodData=e,this.bounds.includeTextLod(e),this.padding=NaN,this.scheduleDirty=!0)}setColorCommutationEnabled(e){return this.colorCommutationEnabled!==e&&(this.colorCommutationEnabled=e,this.scheduleDirty=!0,!0)}updateScale(e){if(e===null||!Number.isFinite(e)||e<=0){let e=this.enabled;return this.enabled=!1,this.independentGroups=1,this.paintOrderApproximated=!1,e}let t=Math.max(.001,4*2**Math.ceil(Math.log2(Math.max(1e-6,e)))),n=Math.min(t,this.paddingLimit);if(this.paintOrderApproximated=n<t,this.enabled&&n===this.padding)return!1;this.enabled=!0,this.padding=n,this.scheduleDirty=!0;let r=this.components.length;for(let e=0;e<r;e++)this.pageBounds.set([1/0,1/0,-1/0,-1/0],e*4);let i=[0,0,0,0];for(let e=0;e<this.pageForRun.length;e++){let t=this.kindForRun[e],r=Math.max(.001,n*(t===0?.5:t<3?.125:1));if(this.bounds.getBounds(e,r,i),i.some(Number.isNaN)&&i.splice(0,4,-1/0,-1/0,1/0,1/0),this.paintBounds.set(i,e*4),i[0]>i[2]||i[1]>i[3])continue;let a=this.pageForRun[e]*4;this.pageBounds[a]=Math.min(this.pageBounds[a],i[0]),this.pageBounds[a+1]=Math.min(this.pageBounds[a+1],i[1]),this.pageBounds[a+2]=Math.max(this.pageBounds[a+2],i[2]),this.pageBounds[a+3]=Math.max(this.pageBounds[a+3],i[3])}let a=Int32Array.from({length:r},(e,t)=>t),o=e=>{for(;a[e]!==e;)a[e]=a[a[e]],e=a[e];return e};for(let e=0;!this.independentPages&&e<r;e++){let t=e*4,n=this.pageBounds;if(!(n[t]>n[t+2]||n[t+1]>n[t+3]))for(let r=0;r<e;r++){let i=r*4;if(n[i]>n[i+2]||n[i+1]>n[i+3]||n[t+2]<n[i]||n[i+2]<n[t]||n[t+3]<n[i+1]||n[i+3]<n[t+1])continue;let s=o(e),c=o(r);a[Math.max(s,c)]=Math.min(s,c)}}let s=/* @__PURE__ */ new Set;for(let e=0;e<r;e++){let t=o(e);this.components[e]=t,s.add(t)}return this.independentGroups=s.size,!0}schedule(e){if(!this.enabled)return e;if(this.allPaints)return this.scheduleDirty&&(this.scheduleDirty=!1,this.schedulePaints(this.allPaints)),e.length===this.allPaints.length?this.compacted:this.filterSchedule(e);if(!this.scheduleDirty&&e.length<=this.previousPaintCount&&e.length>=this.previousPaintCount*.875){let t=0;for(let n=0;n<this.previousPaintCount&&t<e.length;n++)e[t]===this.previousPaints[n]&&t++;if(t===e.length)return e.length===this.previousPaintCount?this.compacted:this.filterSchedule(e)}return this.previousPaints.set(e),this.previousPaintCount=e.length,this.scheduleDirty=!1,this.schedulePaints(e)}filterSchedule(e){this.selectedPaints.fill(0);for(let t of e)this.selectedPaints[t]=1;this.filtered.length=0;for(let e of this.compacted)this.selectedPaints[e]&&this.filtered.push(e);return this.filtered}schedulePaints(e){if(this.compacted.length=0,!this.segments)return this.appendSchedule(e),this.compacted;for(let t=0;t<e.length;){let n=this.segments[e[t]];for(this.segmentRuns.length=0;t<e.length&&this.segments[e[t]]===n;)this.segmentRuns.push(e[t++]);this.appendSchedule(this.segmentRuns)}return this.compacted}appendSchedule(e){this.appendCompacted(this.independentGroups<=1?e:this.interleave(e))}interleave(e){this.heads.fill(-1),this.tails.fill(-1),this.ordered.length=0;for(let t of e){let e=this.components[this.pageForRun[t]];this.tails[e]<0?this.heads[e]=t:this.next[this.tails[e]]=t,this.tails[e]=t,this.next[t]=-1}let t=new Uint32Array(wi.length);for(;this.ordered.length<e.length;){t.fill(0);for(let e of this.heads)e>=0&&t[this.kindForRun[e]]++;let e=0;for(let n=1;n<t.length;n++)t[n]>t[e]&&(e=n);for(let t=0;t<this.heads.length;t++){let n=this.heads[t];for(;n>=0&&this.kindForRun[n]===e;)this.ordered.push(n),n=this.next[n];this.heads[t]=n}}return this.ordered}appendCompacted(e){this.colorCommutationEnabled&&(e=this.groupUniformColors(e));for(let t=0;t<e.length;t++)this.next[e[t]]=e[t+1]??-1;let t=e[0]??-1,n=Math.max(8192,e.length*128);for(;t>=0;){let e=this.kindForRun[t];if(this.compacted.push(t),t=this.next[t],e>=3)continue;let r=t,i=-1,a=0;for(;r>=0&&a<128&&n>0;){let o=this.next[r],s=this.kindForRun[r]===e;if(s){for(let e=0;e<a;e++)if(n--<=0||this.dependsOn(r,this.skipped[e])){s=!1;break}}s?(this.compacted.push(r),i<0?t=o:this.next[i]=o):(this.skipped[a++]=r,i=r),r=o}}}groupUniformColors(e){this.colorGrouped.length=0;for(let t=0;t<e.length;){let n=this.colorForRun[e[t]],r=t+1;if(n>0)for(;r<e.length&&this.colorForRun[e[r]]===n;)r++;if(r===t+1)this.colorGrouped.push(e[t]);else for(let n=0;n<3;n++)for(let i=t;i<r;i++){let t=e[i];this.kindForRun[t]===n&&this.colorGrouped.push(t)}t=r}return this.colorGrouped}dependsOn(e,t){if(this.independentPages&&this.pageForRun[e]!==this.pageForRun[t])return!1;let n=this.colorForRun[e];return this.colorCommutationEnabled&&n>0&&n===this.colorForRun[t]?!1:this.overlaps(e,t)}overlaps(e,t){let n=e*4,r=t*4,i=this.paintBounds;return!(i[n]>i[n+2]||i[n+1]>i[n+3]||i[r]>i[r+2]||i[r+1]>i[r+3]||i[n+2]<i[r]||i[r+2]<i[n]||i[n+3]<i[r+1]||i[r+3]<i[n+1])}};function Ei(e,t,n){let r=e.drawRuns,i=new Int32Array(r.length),a=new Float32Array(r.length*3),o=/* @__PURE__ */ new Map,s=(e,t,n,r)=>{if(i[e]<0)return;let s=e*3;if(!Number.isFinite(t)||!Number.isFinite(n)||!Number.isFinite(r)){i[e]=-1;return}if(i[e]>0){(a[s]!==t||a[s+1]!==n||a[s+2]!==r)&&(i[e]=-1);return}a[s]=t,a[s+1]=n,a[s+2]=r;let c=`${t},${n},${r}`,l=o.get(c);l===void 0&&(l=o.size+1,o.set(c,l)),i[e]=l};r.forEach((t,n)=>{if(t.blendMode||t.kind!==`stroke`&&t.kind!==`fill`&&t.kind!==`text`){i[n]=-1;return}if(t.kind!==`stroke`)for(let r=t.first;r<t.first+t.count&&i[n]>=0;r++){let i=r*4;t.kind===`fill`?s(n,e.fillPathMetaB[i+2],e.fillPathMetaB[i+3],e.fillPathMetaC[i+2]):s(n,Di(e.textInstanceC[i]),Di(e.textInstanceC[i+1]),Di(e.textInstanceC[i+2]))}});for(let e of t.segments){let t=e.scene.styles;for(let r=0;r<e.count;r++){let i=r*4;s(n[e.first+r],t[i+1],t[i+2],t[i+3])}}return i}function Di(e){return Number.isFinite(e)?Math.fround(Math.round(Math.max(0,Math.min(1,e))*255)/255):NaN}var Oi=class{culledCount=0;records;groupOffsets;groupAxes;candidates;candidateBits;sortedCandidateIds;sortedCandidateSlots;slotGroups;startRanks;selected;removed;visited;touched;groupCulled;coverage;activeSlots;previousSlots;previousCount=0;revision=0;constructor(e,t){this.records=t?he(t):pe(e);let n=this.records.count,r=e.drawRuns??[{kind:`stroke`,first:0,count:e.segmentCount}],i=t?.sourceRuns??new Uint32Array(n).fill(4294967295);t||r.forEach((e,t)=>{e.kind===`stroke`&&i.fill(t,e.first,e.first+e.count)});let a=n?ki(e,this.records,i,r):new Uint32Array(r.length),o=[],s=[],c=/* @__PURE__ */ new Map;if(!Qe(e))for(let e of this.records.segments)for(let t=0;t<e.count;t++){let n=e.scene,l=e.first+t,u=t*4,d=r[i[l]];if(!d||a[i[l]]===0||n.primitiveMeta[u+2]!==0)continue;let f=n.primitiveMeta[u+3],p=Math.floor(f/2+1e-6),m=n.styles[u];if(!Number.isInteger(p)||p<0||p>7||f-p*2!=1||!Number.isFinite(m)||m<0)continue;let h=n.endpoints[u],g=n.endpoints[u+1],_=n.primitiveMeta[u],v=n.primitiveMeta[u+1];if(![h,g,_,v].every(Number.isFinite)||h===_&&g===v)continue;let y=_-h,b=v-g,x=Math.abs(y)>=Math.abs(b)?0:1,S=x===0?b/y:y/b,C=x===0?g-S*h:h-S*g,w=`${a[i[l]]},${d.clipIndex??-1},${p},${x},${S},${C}`;if(p&4){let e=n.primitiveBounds;if(![e[u],e[u+1],e[u+2],e[u+3]].every(Number.isFinite))continue;w+=`,${e[u]},${e[u+1]},${e[u+2]},${e[u+3]}`}let T=c.get(w);if(T===void 0)T=o.length,c.set(w,T),o.push([]),s.push(x);else{let e=o[T][0],t=ge(this.records,e),n=(e-t.first)*4,r=t.scene,i=r.endpoints[n],a=r.endpoints[n+1],s=r.primitiveMeta[n]-i,c=r.primitiveMeta[n+1]-a;if((h-i)*c!==(g-a)*s||(_-i)*c!==(v-a)*s)continue}o[T].push(l)}let l=0,u=0,d=0;for(let e of o)e.length>1&&(l+=e.length,u++,d=Math.max(d,e.length));this.candidates=new Uint32Array(l),this.candidateBits=new Uint32Array(Math.ceil(n/32)),this.slotGroups=new Uint32Array(l),this.startRanks=new Uint32Array(l),this.selected=new Uint32Array(l),this.removed=new Uint8Array(l),this.groupOffsets=new Uint32Array(u+2),this.groupAxes=new Uint8Array(u+1),this.visited=new Uint32Array(u+1),this.touched=new Uint32Array(u),this.groupCulled=new Uint32Array(u+1),this.coverage=new Float64Array(d+1),this.activeSlots=new Uint32Array(l),this.previousSlots=new Uint32Array(l);let f=0,p=0;o.forEach((e,t)=>{if(e.length<2)return;p++;let n=s[t];this.groupAxes[p]=n,this.groupOffsets[p]=f,e.sort((e,t)=>this.start(e,n)-this.start(t,n));let r=/* @__PURE__ */ new Map,a=0,o=-1/0;for(let t of e){let e=this.start(t,n);e!==o&&(a++,o=e),r.set(t,a)}let c=e=>{let t=ge(this.records,e),n=t.scene,r=(e-t.first)*4;return Math.floor(n.primitiveMeta[r+3]/2+1e-6)&1?0:n.styles[r]};e.sort((e,t)=>c(t)-c(e)||this.start(e,n)-this.start(t,n)||this.end(t,n)-this.end(e,n)||i[t]-i[e]||t-e);for(let t of e)this.candidates[f]=t,this.slotGroups[f]=p,this.startRanks[f]=r.get(t),this.candidateBits[t>>>5]|=1<<(t&31),f++}),this.groupOffsets[p+1]=f;let m=Uint32Array.from({length:l},(e,t)=>t).sort((e,t)=>this.candidates[e]-this.candidates[t]);this.sortedCandidateIds=Uint32Array.from(m,e=>this.candidates[e]),this.sortedCandidateSlots=m}isCandidate(e){return!!(this.candidateBits[e>>>5]>>>(e&31)&1)}get candidateCount(){return this.candidates.length}update(e,t=e.length){let n=this.revision;++this.revision>4294967295&&(this.revision=1,this.selected.fill(0),this.removed.fill(0),this.visited.fill(0),this.groupCulled.fill(0),this.previousCount=0,this.culledCount=0,n=0);let r=0,i=0;for(let a=0;a<t;a++){let t=e[a];if(!this.isCandidate(t))continue;let o=this.slotOf(t),s=this.slotGroups[o];if(this.selected[o]===this.revision)continue;let c=n===0||this.selected[o]!==n;this.selected[o]=this.revision,this.activeSlots[i++]=o,c&&this.visited[s]!==this.revision&&(this.visited[s]=this.revision,this.touched[r++]=s)}for(let e=0;e<this.previousCount;e++){let t=this.previousSlots[e];if(this.selected[t]===this.revision)continue;let n=this.slotGroups[t];this.visited[n]!==this.revision&&(this.visited[n]=this.revision,this.touched[r++]=n)}let a=this.previousSlots;this.previousSlots=this.activeSlots,this.activeSlots=a,this.previousCount=i;for(let e=0;e<r;e++){let t=this.touched[e],n=this.groupAxes[t],r=this.groupOffsets[t],i=this.groupOffsets[t+1],a=i-r;this.culledCount-=this.groupCulled[t];let o=0;this.coverage.fill(-1/0,0,a+1);for(let e=r;e<i;e++){if(this.removed[e]=0,this.selected[e]!==this.revision)continue;let t=this.startRanks[e],r=this.end(this.candidates[e],n),i=-1/0;for(let e=t;e>0;e-=e&-e)i=Math.max(i,this.coverage[e]);if(i>=r)this.removed[e]=1,o++;else for(let e=t;e<=a;e+=e&-e)this.coverage[e]=Math.max(this.coverage[e],r)}this.groupCulled[t]=o,this.culledCount+=o}}isRetained(e){return!this.isCandidate(e)||this.removed[this.slotOf(e)]!==1}slotOf(e){let t=this.sortedCandidateIds,n=0,r=t.length-1;for(;n<r;){let i=n+r>>>1;t[i]<e?n=i+1:r=i}return this.sortedCandidateSlots[n]}start(e,t){let n=ge(this.records,e),r=(e-n.first)*4+t;return Math.min(n.scene.endpoints[r],n.scene.primitiveMeta[r])}end(e,t){let n=ge(this.records,e),r=(e-n.first)*4+t;return Math.max(n.scene.endpoints[r],n.scene.primitiveMeta[r])}};function ki(e,t,n,r){let i=Array(r.length).fill(void 0),a=(e,t,n,r)=>{if(i[e]===null)return;if(![t,n,r].every(Number.isFinite)){i[e]=null;return}let a=`${t},${n},${r}`;i[e]===void 0?i[e]=a:i[e]!==a&&(i[e]=null)};r.forEach((t,n)=>{if(t.blendMode||t.kind!==`stroke`&&t.kind!==`fill`&&t.kind!==`text`){i[n]=null;return}if(t.kind!==`stroke`)for(let r=t.first;r<t.first+t.count&&i[n]!==null;r++){let i=r*4;t.kind===`fill`?a(n,e.fillPathMetaB[i+2],e.fillPathMetaB[i+3],e.fillPathMetaC[i+2]):a(n,Ai(e.textInstanceC[i]),Ai(e.textInstanceC[i+1]),Ai(e.textInstanceC[i+2]))}});for(let e of t.segments){let t=e.scene.styles;for(let i=0;i<e.count;i++){let o=n[e.first+i];r[o]?.kind===`stroke`&&a(o,t[i*4+1],t[i*4+2],t[i*4+3])}}let o=new Uint32Array(r.length),s=0,c;return i.forEach((e,t)=>{(e!==c||!e)&&s++,e&&(o[t]=s),c=e}),o}function Ai(e){return Number.isFinite(e)?Math.fround(Math.round(Math.max(0,Math.min(1,e))*255)/255):NaN}var ji=class e{clipCodes;originals;clearances;padding=NaN;static create(t,n){return!t.clipPaths?.length||!t.drawRuns?.some(e=>e.clipIndex!==void 0&&(e.kind===`stroke`||e.kind===`fill`||e.kind===`text`))?null:new e(t,n)}constructor(e,t){let n=e.drawRuns;this.clipCodes=Uint32Array.from(n,e=>(e.clipIndex??-1)+1),this.originals=this.clipCodes.slice(),this.clearances=new Float64Array(n.length).fill(-1/0);let r=o(e.clipPaths),i=new Te(e,t),a=[0,0,0,0];n.forEach((e,t)=>{if(e.clipIndex===void 0||e.kind!==`stroke`&&e.kind!==`fill`&&e.kind!==`text`)return;let n=e.clipIndex*4;if(r[n]!==-1||r[n+2]!==-1)return;let o=r[n+1]*4;i.getUnclippedBounds(t,0,a),!(!a.every(Number.isFinite)||a[0]>a[2]||a[1]>a[3])&&(this.clearances[t]=Math.min(a[0]-r[o],a[1]-r[o+1],r[o+2]-a[2],r[o+3]-a[3]))})}update(e){let t=e!==null&&Number.isFinite(e)&&e>0?Math.max(.001,4*2**Math.ceil(Math.log2(Math.max(1e-6,e)))):1/0;if(t===this.padding)return!1;this.padding=t;let n=!1;for(let e=0;e<this.clipCodes.length;e++){let r=this.clearances[e]>t?0:this.originals[e];this.clipCodes[e]!==r&&(this.clipCodes[e]=r,n=!0)}return n}};const Mi=[`endpoints`,`primitiveMeta`,`primitiveBounds`,`styles`],Ni=/* @__PURE__ */ new WeakMap,Pi=/* @__PURE__ */ new WeakMap;function Fi(e,t){let n=Ni.get(t);if(n)return n;let r=Math.max(0,e.segmentCount|0),i=[],a=r,o=(e,t)=>{t<=0||(i.push({base:a,scene:e}),a+=t)},s=t.find(e=>e.store)?.store;if(s){if(s.canonical!==e)throw Error(`Vector LOD store belongs to a different scene.`);o(s.literals,Math.max(0,s.literals.segmentCount|0))}let c=[],l=[];t.forEach((t,n)=>{if(t.store){if(t.store!==s)throw Error(`Vector LOD levels belong to different hierarchies.`);c.push(t.records??null),l.push(0);return}if(c.push(null),n===0&&t.scene===e){l.push(0);return}l.push(a),o(t.scene,Math.max(0,t.segmentCount|0))});let u={canonical:e,count:a,parts:i,records:c,bases:l};return Ni.set(t,u),u}function Ii(e){let t=[{first:0,count:Math.max(0,e.canonical.segmentCount|0),scene:e.canonical}];return e.parts.forEach((n,r)=>t.push({first:n.base,count:(e.parts[r+1]?.base??e.count)-n.base,scene:n.scene})),{count:e.count,segments:t}}function Li(e){let t=e.canonical,n=Math.max(0,t.segmentCount|0);if(!lt(t))return;let r=new Uint32Array(e.count),i=ct(t);if(i)r.set(i.subarray(0,n));else for(let e=0;e<n;e++)r[e]=e;for(let t of e.parts)r.set(ot(t.scene),t.base);return r}function Ri(e){if(!e.store)return e.scene;if(!e.records)return e.store.canonical;let t=Pi.get(e.records);return t||(t=Bi(e),Pi.set(e.records,t)),t}function zi(e){return e.store?e.records?Pi.get(e.records)??Bi(e):e.store.canonical:e.scene}function Bi(e){let{canonical:t,literals:n}=e.store,r=Math.max(0,t.segmentCount|0),i=Math.max(0,e.segmentCount|0),a=e.records,o={...t,segmentCount:i,bounds:e.sceneBounds,maxHalfWidth:e.maxHalfWidth};for(let e of Mi){let s=new Float32Array(i*4),c=Vi(s),l=Vi(t[e]),u=Vi(n[e]);for(let e=0;e<i;e++){let t=a[e],n=t<r?l:u,i=(t<r?t:t-r)*4;c[e*4]=n[i],c[e*4+1]=n[i+1],c[e*4+2]=n[i+2],c[e*4+3]=n[i+3]}o[e]=s}if(lt(t)){let e=ot(n),s=new Uint32Array(i);for(let n=0;n<i;n++){let i=a[n];s[n]=i<r?ut(t,i):e[i-r]}st(o,s)}return o}function Vi(e){return new Uint32Array(e.buffer,e.byteOffset,e.length)}var Hi=class{batches=[];revision=0;coverageRevision=0;batchSegments=[];spanOrdered=!0;scheduledRuns;scheduledSpanPrefix=/* @__PURE__ */ new Uint32Array;floatInstanceData=/* @__PURE__ */ new Float32Array;uintInstanceData=/* @__PURE__ */ new Uint32Array(2);floatInstancesDirty=!0;get floatInstances(){return this.floatInstanceData.length<this.uintInstanceData.length&&(this.floatInstanceData=new Float32Array(this.uintInstanceData.length)),this.floatInstancesDirty&&=(this.floatInstanceData.set(this.uintInstanceData.subarray(0,this.instanceCount*2)),!1),this.floatInstanceData}get uintInstances(){return this.uintInstanceData}strokeRecords;cullingPadding;instanceCount=0;culledSegmentCount=0;get paintOrderApproximated(){return this.scheduler?.paintOrderApproximated??!1}runtime;runIndices=/* @__PURE__ */ new Map;rankToId;idToRank;runRankOffsets;layout=null;selectionLimit;selectedRanks=/* @__PURE__ */ new Uint32Array;selectedRankBits;selectedRankWords;orderedSelectedCount=0;previousSelectedIds=/* @__PURE__ */ new Uint32Array;previousSelectedCount=0;sourceRuns;runRanges;visiblePaints=[];scheduler=null;segments=null;scene;strokeSourceRuns;strokeColorsMatchSource;clipElision;redundancy;redundancyIds=/* @__PURE__ */ new Uint32Array;redundancyEnabled=!0;blackPreserved=!0;previousSelectedRanks=/* @__PURE__ */ new Uint32Array;previousRankCount=0;previousRuns=[];previousRunsAreSource=!1;initialized=!1;dirty=!0;orderDirty=!1;textSelection=null;textSelectionRevision=0;get colorBatchingEnabled(){return this.redundancyEnabled&&this.strokeColorsMatchSource}get blackDarkenSourceOverEnabled(){return this.colorBatchingEnabled&&this.blackPreserved}constructor(e,t){this.scene=e,this.runtime=t,this.cullingPadding=(t?.levels.at(-1)?.tolerance??0)*2;let n=e.drawRuns;this.sourceRuns=n,this.runRanges=new Uint32Array(n.length*2);let r=new Uint32Array(e.segmentCount);n.forEach((e,t)=>{this.runIndices.set(e,t),e.kind===`stroke`&&r.fill(t,e.first,e.first+e.count)}),this.strokeRecords=pe(e);let i=ct(e)??Ui(e.segmentCount);this.selectionLimit=e.segmentCount,t&&(this.layout=Fi(e,t.levels),this.strokeRecords=Ii(this.layout),i=Li(this.layout),this.selectionLimit=t.levels.reduce((e,t)=>e+t.segmentCount,0));let a=this.strokeRecords.count;this.rankToId=new Uint32Array(a),this.idToRank=new Uint32Array(a),this.runRankOffsets=new Uint32Array(n.length+1),this.selectedRankBits=new Uint32Array(Math.ceil(a/32)),this.selectedRankWords=new Uint32Array(Math.ceil(this.selectedRankBits.length/32));let o=new Uint32Array(e.segmentCount);for(let e=0;e<a;e++)o[i[e]]++;for(let e=0;e<o.length;e++)this.runRankOffsets[r[e]+1]+=o[e];for(let e=1;e<this.runRankOffsets.length;e++)this.runRankOffsets[e]+=this.runRankOffsets[e-1];let s=this.runRankOffsets.slice(0,-1);for(let e=0;e<o.length;e++){let t=r[e],n=o[e];o[e]=s[t],s[t]+=n}let c=new Uint32Array(a);for(let e=0;e<a;e++){let t=i[e],n=o[t]++;this.rankToId[n]=e,this.idToRank[e]=n,c[e]=r[t]}this.strokeSourceRuns=c,this.strokeColorsMatchSource=!t||me(e,this.strokeRecords,i),this.rebuildScheduler(),this.clipElision=ji.create(e,{records:this.strokeRecords,sourceRuns:c}),this.redundancy=new Oi(e,{records:this.strokeRecords,sourceRuns:c}),this.scheduledRuns=new Uint8Array(n.length)}scheduledSpanRunCount(e,t){return this.scheduledSpanPrefix[t+1]-this.scheduledSpanPrefix[e]}createRunCuller(){return new Te(this.scene,this.runtime?{records:this.strokeRecords,sourceRuns:this.strokeSourceRuns}:void 0)}invalidate(){this.dirty=!0}setTextSelection(e){let t=e?.revision??0;(this.textSelection!==e||this.textSelectionRevision!==t)&&(e&&this.scheduler?.includeTextLod(e.data),this.textSelection=e,this.textSelectionRevision=t,this.orderDirty=!0)}setColorCommutationEnabled(e){this.redundancyEnabled!==e&&(this.redundancyEnabled=e,(Qe(this.scene)?Be(this.scene,this.colorBatchingEnabled,this.blackDarkenSourceOverEnabled):null)===this.segments?this.scheduler?.setColorCommutationEnabled(e):this.rebuildScheduler(),this.orderDirty=!0,this.dirty=!0)}setBlackDarkenSourceOverEnabled(e){this.blackPreserved!==e&&(this.blackPreserved=e,(Qe(this.scene)?Be(this.scene,this.colorBatchingEnabled,this.blackDarkenSourceOverEnabled):null)!==this.segments&&(this.rebuildScheduler(),this.orderDirty=!0,this.dirty=!0))}rebuildScheduler(){this.segments=Qe(this.scene)?Be(this.scene,this.colorBatchingEnabled,this.blackDarkenSourceOverEnabled):null;let e=0;for(let t of this.segments??[])e=Math.max(e,t);this.scheduledSpanPrefix=new Uint32Array(e+2),this.scheduler=Ti.create(this.scene,this.strokeRecords,this.strokeSourceRuns,this.segments),this.scheduler?.setColorCommutationEnabled(this.redundancyEnabled),this.textSelection&&this.scheduler?.includeTextLod(this.textSelection.data)}update(e,t=null){let n=this.clipElision?.update(t)??!1,r=(this.scheduler?.updateScale(t)??!1)||this.orderDirty||n;this.orderDirty=!1;let i=this.initialized&&e.length===this.previousRuns.length;if(i&&!(e===this.sourceRuns&&this.previousRunsAreSource)){for(let t=0;t<e.length;t++)if(e[t]!==this.previousRuns[t]){i=!1;break}}if(i&&(this.previousRunsAreSource=e===this.sourceRuns),!this.dirty&&i&&!r)return!1;this.dirty=!1;let a=0,o=this.initialized;if(this.runtime){let e=this.layout,t=this.runtime.levels.reduce((e,t)=>e+t.visibleSegmentCount,0);this.previousSelectedIds=Wi(this.previousSelectedIds,t,this.selectionLimit,!0),this.selectedRanks=Wi(this.selectedRanks,t,this.idToRank.length),this.runtime.levels.forEach((t,n)=>{let r=e.records[n],i=e.bases[n];for(let e=0;e<t.visibleSegmentCount;e++){let n=t.visibleSegmentIds[e],s=r?r[n]:i+n;this.previousSelectedIds[a]!==s&&(o=!1),this.previousSelectedIds[a++]=s}})}if(o&&=a===this.previousSelectedCount,this.previousSelectedCount=a,o&&i&&!r)return!1;if(!o){for(let e=0;e<a;e++){let t=this.idToRank[this.previousSelectedIds[e]],n=t>>>5;this.selectedRankBits[n]|=1<<(t&31),this.selectedRankWords[n>>>5]|=1<<(n&31)}let e=0;for(let t=0;t<this.selectedRankWords.length;t++){let n=this.selectedRankWords[t];for(this.selectedRankWords[t]=0;n!==0;){let r=t*32+31-Math.clz32(n&-n),i=this.selectedRankBits[r];for(this.selectedRankBits[r]=0;i!==0;)this.selectedRanks[e++]=r*32+31-Math.clz32(i&-i),i=(i&i-1)>>>0;n=(n&n-1)>>>0}}this.orderedSelectedCount=e}a=this.orderedSelectedCount;let s=i&&a===this.previousRankCount;if(s){for(let e=0;e<a;e++)if(this.previousSelectedRanks[e]!==this.selectedRanks[e]){s=!1;break}}if(s&&!r)return!1;if(this.initialized=!0,!i){this.previousRuns.length=e.length;for(let t=0;t<e.length;t++)this.previousRuns[t]=e[t]}this.previousRunsAreSource=e===this.sourceRuns,this.previousSelectedRanks.length<a&&(this.previousSelectedRanks=new Uint32Array(Math.min(this.selectedRanks.length,Math.max(a,this.previousSelectedRanks.length*2)))),this.previousSelectedRanks.set(this.selectedRanks.subarray(0,a)),this.previousRankCount=a,this.revision++,i||this.coverageRevision++,this.batches.length=0,this.batchSegments.length=0,this.spanOrdered=!0,this.instanceCount=0,this.culledSegmentCount=0,this.visiblePaints.length=0,this.scheduledRuns.fill(0),this.scheduledSpanPrefix.fill(0);let c=0;for(let t of e){let e=this.runIndices.get(t);this.scheduledRuns[e]=1,this.scheduledSpanPrefix[(this.segments?.[e]??0)+1]++;let n=t.first,r=t.count;if(t.kind===`stroke`&&this.runtime){for(;c<a&&this.selectedRanks[c]<this.runRankOffsets[e];)c++;for(n=c;c<a&&this.selectedRanks[c]<this.runRankOffsets[e+1];)c++;r=c-n}t.kind===`text`&&this.textSelection&&(n=this.textSelection.ranges[e*2],r=this.textSelection.ranges[e*2+1]),r!==0&&(this.runRanges[e*2]=n,this.runRanges[e*2+1]=r,this.visiblePaints.push(e))}for(let e=1;e<this.scheduledSpanPrefix.length;e++)this.scheduledSpanPrefix[e]+=this.scheduledSpanPrefix[e-1];let l=0,u=0;for(let e of this.visiblePaints){let t=this.sourceRuns[e].kind,n=this.runRanges[e*2+1];t===`stroke`&&(l+=n),(t===`stroke`||t===`fill`||t===`text`)&&(u+=n)}if(this.uintInstanceData=Wi(this.uintInstanceData,u*2),this.redundancyEnabled){this.redundancyIds=Wi(this.redundancyIds,Math.min(l,this.redundancy.candidateCount),this.rankToId.length);let e=0;for(let t of this.visiblePaints){if(this.sourceRuns[t].kind!==`stroke`)continue;let n=this.runRanges[t*2],r=n+this.runRanges[t*2+1];for(let t=n;t<r;t++){let n=this.runtime?this.rankToId[this.selectedRanks[t]]:t;this.redundancy.isCandidate(n)&&(e===this.redundancyIds.length&&(this.redundancyIds=Wi(this.redundancyIds,e+1,1/0,!0)),this.redundancyIds[e++]=n)}}this.redundancy.update(this.redundancyIds,e),this.culledSegmentCount=this.redundancy.culledCount}let d=this.scheduler?.schedule(this.visiblePaints)??this.visiblePaints;for(let e of d){let t=this.sourceRuns[e],n=this.segments?this.segments[e]:0,r=this.runRanges[e*2],i=this.runRanges[e*2+1];if(t.kind!==`stroke`&&t.kind!==`fill`&&t.kind!==`text`){this.pushBatch({...t},n);continue}let a=this.instanceCount,o=t.kind===`text`&&this.textSelection?(t.clipIndex??-1)+1:this.clipElision?.clipCodes[e]??(t.clipIndex??-1)+1;if(t.kind===`text`&&this.textSelection)for(let e=r;e<r+i;e++)this.appendInstance(this.textSelection.instanceIds[e],o);else if(t.kind===`stroke`&&this.runtime)for(let e=r;e<r+i;e++){let t=this.rankToId[this.selectedRanks[e]];(!this.redundancyEnabled||this.redundancy.isRetained(t))&&this.appendInstance(t,o)}else for(let e=r;e<r+i;e++)(t.kind!==`stroke`||!this.redundancyEnabled||this.redundancy.isRetained(e))&&this.appendInstance(e,o);let s=this.instanceCount-a;if(!s)continue;let c=this.batches[this.batches.length-1];c?.kind===t.kind&&c.clipIndex===-2&&c.blendMode===t.blendMode&&this.batchSegments[this.batches.length-1]===n?c.count+=s:this.pushBatch({kind:t.kind,first:a,count:s,clipIndex:-2,...t.blendMode?{blendMode:t.blendMode}:{}},n)}return this.floatInstancesDirty=!0,!0}pushBatch(e,t){let n=this.batches[this.batches.length-1];if(e.kind===`raster`&&!e.blendMode&&i(n,e)&&this.batchSegments[this.batchSegments.length-1]===t){n.count+=e.count;return}t<(this.batchSegments[this.batchSegments.length-1]??0)&&(this.spanOrdered=!1),this.batches.push(e),this.batchSegments.push(t)}appendInstance(e,t){let n=this.instanceCount*2;this.uintInstances[n]=e,this.uintInstances[n+1]=t,this.instanceCount++}};function Ui(e){let t=new Uint32Array(e);for(let n=0;n<e;n++)t[n]=n;return t}function Wi(e,t,n=1/0,r=!1){if(e.length>=t)return e;let i=new Uint32Array(Math.min(n,Math.max(t,e.length*2,256)));return r&&i.set(e),i}var Gi=class{batches=[];batchSegments=[];instanceCount=0;revision=0;instanceData=/* @__PURE__ */ new Uint32Array;floatData=/* @__PURE__ */ new Float32Array;floatsDirty=!1;source=null;sourceRevision=-1;get uintInstances(){return this.instanceData}get floatInstances(){if(this.floatData.length<this.instanceCount*3&&(this.floatData=new Float32Array(this.instanceData.length),this.floatsDirty=!0),this.floatsDirty){let e=this.instanceCount*3;for(let t=0;t<e;t++)this.floatData[t]=this.instanceData[t];this.floatsDirty=!1}return this.floatData}update(e){if(this.source===e&&this.sourceRevision===e.revision)return!1;this.source=e,this.sourceRevision=e.revision,this.batches.length=0,this.batchSegments.length=0,this.instanceCount=0;let t=[];for(let n=0;n<e.batches.length;){let r=e.batchSegments[n]??0,i=n,a=0,o=0;for(;i<e.batches.length&&(e.batchSegments[i]??0)===r;){let t=e.batches[i];if(!Ki(t))break;t.kind===`stroke`?a+=t.count:o+=t.count,i++}if(a>0&&o>0){let e=a+o;this.batches.push({kind:`mixed-vector`,first:this.instanceCount,count:e,strokeCount:a,fillCount:o,clipIndex:-2}),this.batchSegments.push(r),t.push({first:n,end:i,output:this.instanceCount}),this.instanceCount+=e,n=i}else{let t=Math.max(i,n+1);for(let r=n;r<t;r++)this.batches.push(e.batches[r]),this.batchSegments.push(e.batchSegments[r]??0);n=t}}let n=this.instanceCount*3;this.instanceData.length<n&&(this.instanceData=new Uint32Array(Math.max(n,this.instanceData.length*2)));let r=e.uintInstances;for(let n of t){let t=n.output*3;for(let i=n.first;i<n.end;i++){let n=e.batches[i],a=n.kind===`stroke`?0:1;for(let e=n.first;e<n.first+n.count;e++)this.instanceData[t++]=r[e*2],this.instanceData[t++]=r[e*2+1],this.instanceData[t++]=a}}return this.floatsDirty=!0,this.revision++,!0}};function Ki(e){return(e.kind===`stroke`||e.kind===`fill`)&&e.clipIndex===-2&&e.blendMode===void 0&&e.count>0}const qi=/* @__PURE__ */ new Set([`vP0`,`vP1`,`vP2`,`vPrimitiveType`,`vIsHairline`,`vHalfWidth`,`vAAWorld`,`vClipBounds`,`vHasClipBounds`,`vSegmentStart`,`vSegmentCount`,`vFillPathIndex`,`vFillOrigin`,`vFillBoundsMax`,`vFillSignedArea`,`vFillRule`,`vFillHasCompanionStroke`]);function Ji(e,t){return e.replace(/^#version 300 es\s*/,``).replace(/void main\(\)/,`void ${t}()`).replace(/^(?:flat )?(?:in|out) (\w+) (\w+);$/gm,(e,t,n)=>qi.has(n)?`${t} ${n} = ${t}(0);`:e)}function Yi(e,t){let n=/* @__PURE__ */ new Set;return`#version 300 es\nprecision highp float;\nprecision highp int;\n${e}\n${t}`.replace(/^(?:precision |uniform |(?:layout\([^\n]*\) )?(?:flat )?(?:in|out) )[^\n]*;$/gm,e=>n.has(e)?``:(n.add(e),e))}function Xi(e){return e.replace(/vec4 heprThreeEncodeOutputColor\(vec4 color\) \{[^}]*\}/,``).replace(/float heprThreeLinearCoverageToOutputAlpha\(float coverage\) \{[^}]*\}/,``)}const Zi=Yi(Ji(vn,`heprMixedStrokeVertex`).replaceAll(`aSegmentIndex`,`aVectorIndex`),Ji(bn,`heprMixedFillVertex`).replace(`layout(location = 3)`,`layout(location = 1)`).replaceAll(`aFillPathIndex`,`aVectorIndex`))+`
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
`,Qi=Ji(yn,`heprMixedStrokeFragment`).replace(`length(vec2(dFdx(vLocal.x), dFdy(vLocal.x)))`,`heprMixedLocalPerPixel.x`).replace(`length(vec2(dFdx(vLocal.y), dFdy(vLocal.y)))`,`heprMixedLocalPerPixel.y`),$i=Xi(Ji(xn,`heprMixedFillFragment`).replace(hn,``)).replace(/\bpacked\b/g,`packedFillIndices`).replace(/vec2 footprint = max\(vec2\(\s*length\(vec2\(dFdx\(vLocal.x\), dFdy\(vLocal.x\)\)\),\s*length\(vec2\(dFdx\(vLocal.y\), dFdy\(vLocal.y\)\)\)\s*\) \* uFillAAScreenPx, vec2\(1e-4\)\);/,`vec2 footprint = max(heprMixedLocalPerPixel * uFillAAScreenPx, vec2(1e-4));`),ea=Yi(`vec2 heprMixedLocalPerPixel = vec2(0.0);\n${Qi}`,$i)+`
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
`;var ta=class{ranges;data;instanceIds=/* @__PURE__ */ new Uint32Array;revision=0;paints;coarsePaints;exactCount;counts;cursors;selectedPaints=/* @__PURE__ */ new Uint32Array;constructor(e,t){this.data=t;let n=e.drawRuns??[];this.paints=n.flatMap((e,t)=>e.kind===`text`?[{first:e.first,end:e.first+e.count,index:t}]:[]).sort((e,t)=>e.first-t.first),this.exactCount=t.exactInstanceCount,this.ranges=new Uint32Array(n.length*2),this.counts=new Uint32Array(n.length),this.cursors=new Uint32Array(n.length),this.coarsePaints=new Uint32Array(t.coarseInstanceCount);for(let e of t.runs){if(e.coarseIndex<0)continue;let t=this.paintAt(e.exactStart);if(e.exactStart+e.exactCount>t.end)throw Error(`Text LOD crosses a PDF paint boundary.`);this.coarsePaints[e.coarseIndex]=t.index}}update(e){if(this.revision&&!e.changed)return;let t=e.instanceIds;this.instanceIds.length<t.length&&(this.instanceIds=new Uint32Array(t.length),this.selectedPaints=new Uint32Array(t.length)),this.counts.fill(0);let n=this.paints[0];for(let e=0;e<t.length;e++){let r=t[e];r<this.exactCount&&(!n||r<n.first||r>=n.end)&&(n=this.paintAt(r));let i=r<this.exactCount?n.index:this.coarsePaints[r-this.exactCount];this.selectedPaints[e]=i,this.counts[i]++}let r=0;for(let e=0;e<this.counts.length;e++)this.ranges[e*2]=this.cursors[e]=r,this.ranges[e*2+1]=this.counts[e],r+=this.counts[e];for(let e=0;e<t.length;e++)this.instanceIds[this.cursors[this.selectedPaints[e]]++]=t[e];this.revision++}paintAt(e){let t=0,n=this.paints.length;for(;t<n;){let r=t+n>>>1;this.paints[r].end<=e?t=r+1:n=r}let r=this.paints[t];if(!r||e<r.first)throw Error(`Text LOD glyph has no PDF paint.`);return r}};function na(e,t){return e>1e5&&t===0}const ra=.35,ia=1024;function aa(e,t,n){let r=t*4,i=e.styles[r],a=i+ra,o=e.primitiveBounds;n.minX=o[r]-a,n.minY=o[r+1]-a,n.maxX=o[r+2]+a,n.maxY=o[r+3]+a;let s=e.primitiveMeta;if(!(Math.floor(s[r+3]/2+1e-6)&4))return!0;let c=e.endpoints,l=Math.SQRT2*Math.max(0,i)+ra;return n.minX=Math.max(n.minX,Math.min(c[r],c[r+2],s[r])-l),n.minY=Math.max(n.minY,Math.min(c[r+1],c[r+3],s[r+1])-l),n.maxX=Math.min(n.maxX,Math.max(c[r],c[r+2],s[r])+l),n.maxY=Math.min(n.maxY,Math.max(c[r+1],c[r+3],s[r+1])+l),n.minX<=n.maxX&&n.minY<=n.maxY}function oa(e){let t=e.segmentCount,n=Math.max(e.bounds.maxX-e.bounds.minX,1e-5),r=Math.max(e.bounds.maxY-e.bounds.minY,1e-5),{gridWidth:i,gridHeight:a}=sa(t,n,r),o=i*a,s=n/i,c=r/a,l=new Uint32Array(o),u=0,d={minX:0,minY:0,maxX:0,maxY:0};for(let n=0;n<t;n+=1){if(!aa(e,n,d))continue;let t=U(Math.floor((d.minX-e.bounds.minX)/s),i),r=U(Math.floor((d.maxX-e.bounds.minX)/s),i),o=U(Math.floor((d.minY-e.bounds.minY)/c),a),f=U(Math.floor((d.maxY-e.bounds.minY)/c),a);for(let e=o;e<=f;e+=1){let n=e*i+t;for(let e=t;e<=r;e+=1){let e=l[n]+1;l[n]=e,e>u&&(u=e),n+=1}}}let f=new Uint32Array(o+1);for(let e=0;e<o;e+=1)f[e+1]=f[e]+l[e];let p=f[o],m=new Uint32Array(p),h=f.slice(0,o);for(let n=0;n<t;n+=1){if(!aa(e,n,d))continue;let t=U(Math.floor((d.minX-e.bounds.minX)/s),i),r=U(Math.floor((d.maxX-e.bounds.minX)/s),i),o=U(Math.floor((d.minY-e.bounds.minY)/c),a),l=U(Math.floor((d.maxY-e.bounds.minY)/c),a);for(let e=o;e<=l;e+=1){let a=e*i+t;for(let e=t;e<=r;e+=1){let e=h[a];m[e]=n,h[a]=e+1,a+=1}}}return{gridWidth:i,gridHeight:a,minX:e.bounds.minX,minY:e.bounds.minY,maxX:e.bounds.maxX,maxY:e.bounds.maxY,cellWidth:s,cellHeight:c,offsets:f,counts:l,indices:m,maxCellPopulation:u}}function sa(e,t,n){let r=ca(Math.round(e/8),3e4,22e4),i=t/n,a=Math.round(Math.sqrt(r*i)),o=Math.round(r/Math.max(a,1));return a=ca(a,64,ia),o=ca(o,64,ia),{gridWidth:a,gridHeight:o}}function U(e,t){return e<0?0:e>=t?t-1:e}function ca(e,t,n){return e<t?t:e>n?n:e}const la=.5,ua=1e-6,da=1/512,W=1e-9,fa=.001;function pa(e){let t=Wa();try{let n=ha(e);if(typeof n==`string`)return Aa(null,n,Wa()-t);for(let e=0;e<n.pageCount;e+=1)ga(n,e);return _a(n,t)}catch(e){return ja(e,t)}}function ma(e,t,n){Va(e,t),G(n.textInstanceA,t.combinedInstanceCount,`textInstanceA`),G(n.textInstanceB,t.combinedInstanceCount,`textInstanceB`),G(n.textInstanceC,t.combinedInstanceCount,`textInstanceC`),G(n.textGlyphMetaA,t.solidGlyphIndex+1,`textGlyphMetaA`),G(n.textGlyphMetaB,t.solidGlyphIndex+1,`textGlyphMetaB`),G(n.textGlyphSegmentsA,Math.max(0,e.textGlyphSegmentCount|0)+4,`textGlyphSegmentsA`),G(n.textGlyphSegmentsB,Math.max(0,e.textGlyphSegmentCount|0)+4,`textGlyphSegmentsB`);let r=t.exactInstanceCount*4;n.textInstanceA.set(e.textInstanceA.subarray(0,r),0),n.textInstanceB.set(e.textInstanceB.subarray(0,r),0),n.textInstanceC.set(e.textInstanceC.subarray(0,r),0),n.textInstanceA.set(t.coarseInstanceA,r),n.textInstanceB.set(t.coarseInstanceB,r),n.textInstanceC.set(t.coarseInstanceC,r);for(let e=0;e<t.coarseInstanceCount;e+=1)n.textInstanceB[r+e*4+2]=t.solidGlyphIndex;let i=Math.max(0,e.textGlyphCount|0)*4,a=Math.max(0,e.textGlyphSegmentCount|0)*4;n.textGlyphMetaA.set(e.textGlyphMetaA.subarray(0,i),0),n.textGlyphMetaB.set(e.textGlyphMetaB.subarray(0,i),0),n.textGlyphSegmentsA.set(e.textGlyphSegmentsA.subarray(0,a),0),n.textGlyphSegmentsB.set(e.textGlyphSegmentsB.subarray(0,a),0),n.textGlyphMetaA.set(new Float32Array([Math.max(0,e.textGlyphSegmentCount|0),4,0,0]),i),n.textGlyphMetaB.set(Ga,i),n.textGlyphSegmentsA.set(Ka,a),n.textGlyphSegmentsB.set(qa,a)}function ha(e){let t=Math.max(0,e.textInstanceCount|0),n=Math.max(0,e.pageCount|0);return t<=0||n<=0?`empty-text`:t<5e4?`below-instance-threshold`:Ta(e,t,n)?e.textInstanceA.length<t*4||e.textInstanceB.length<t*4||e.textInstanceC.length<t*4?`invalid-build-data`:{scene:e,instanceCount:t,pageCount:n,inkAreas:Da(e),runs:[],coarse:new ka(Math.min(t,65536)),pageRunStarts:new Uint32Array(n),pageRunCounts:new Uint32Array(n),textPaints:(e.drawRuns??[]).filter(e=>e.kind===`text`).sort((e,t)=>e.first-t.first)}:`invalid-page-ranges`}function ga(e,t,n,r,i=!0,a=!0){let{scene:o,instanceCount:s}=e,c=t*2,l=Math.min(s,o.pageTextRanges[c]),u=Math.min(s,l+o.pageTextRanges[c+1]),d=Math.max(l,Math.min(u,n??l)),f=Math.max(d,Math.min(u,r??u)),p=Na(o,t);i&&(e.pageRunStarts[t]=e.runs.length);let m=d;for(;m<f;){let n=0,r=e.textPaints.length;for(;n<r;){let t=n+r>>>1,i=e.textPaints[t];i.first+i.count<=m?n=t+1:r=t}let i=e.textPaints[n],a=Math.min(f,i?i.first+i.count:f),s=i?.blendMode!==void 0,c=s?null:Ca(e,m);if(!c){let n=m,r=null;for(;m<a&&m-n<512&&(s||!Ca(e,m));)r=La(r,Pa(o,m,p)),m+=1;e.runs.push(Ma({exactStart:n,exactCount:m-n,coarseIndex:-1,pageIndex:t,bounds:r??p,transform:[0,0,0,0,0,0],maxInkHeight:1/0,eligible:!1}));continue}let l=m,u=c.a,d=c.b,h=c.c,g=c.d,_=c.originX,v=c.originY,y=1/c.determinant,b=c.minU,x=c.minV,S=c.maxU,C=c.maxV,w=c.inkArea,T=c.inkHeight,E=Math.max(c.maxU-c.minU,W),D=(c.minU+c.maxU)*.5,O=0;for(m+=1;m<a&&m-l<512;){let t=Ca(e,m);if(!t||!wa(c,t))break;let n=t.originX-_,r=t.originY-v,i=(g*n-h*r)*y,a=(u*r-d*n)*y,o=Math.max(C-x,W);if(Math.abs(a)>o*.05)break;let s=t.minU+i,l=t.minV+a,f=t.maxU+i,p=t.maxV+a,k=Math.max(f-s,W),A=(s+f)*.5,j=A-D,M=Math.min(E,k)*.05,N=j>M?1:j<-M?-1:0,P=O||N,F=Math.max(E,k)*1.5;if(P>0){if(s-S>F||j<-E*la)break}else if(P<0){if(b-f>F||j>E*la)break}else if(Math.max(s-S,b-f,0)>F)break;O===0&&N!==0&&(O=N),b=Math.min(b,s),x=Math.min(x,l),S=Math.max(S,f),C=Math.max(C,p),E=Math.max(E,k),D=A,w+=t.inkArea,T=Math.max(T,t.inkHeight),m+=1}let k=S-b,A=C-x;if(!(k>W)||!(A>W)||!Number.isFinite(w)){e.runs.push(Ma({exactStart:l,exactCount:m-l,coarseIndex:-1,pageIndex:t,bounds:Fa(o,l,m,p),transform:[0,0,0,0,0,0],maxInkHeight:1/0,eligible:!1}));continue}let j=[u*k,d*k,h*A,g*A,u*b+h*x+_,d*b+g*x+v],M=e.coarse.count,N=Math.min(1,Math.max(0,w/(k*A)));e.coarse.push(j[0],j[1],j[2],j[3],j[4],j[5],0,0,c.red,c.green,c.blue,c.alpha*N),e.runs.push(Ma({exactStart:l,exactCount:m-l,coarseIndex:M,pageIndex:t,bounds:Ia(j),transform:j,maxInkHeight:T,eligible:!0}))}a&&(e.pageRunCounts[t]=e.runs.length-e.pageRunStarts[t])}function _a(e,t){let n=va(e);if(n)return Aa(null,n,Wa()-t);let r=ya(e),i=null;for(;!i;){let e=r.next();e.done&&(i=e.value)}return Aa(Sa(e,i,Object.freeze(e.runs.slice()),e.coarse.trimA(),e.coarse.trimB(),e.coarse.trimC()),null,Wa()-t)}function va(e){let t=e.coarse.count;return t<=0?`no-coarse-runs`:t>e.instanceCount*.7?`insufficient-reduction`:null}function*ya(e){let t=[],n=[],r=Math.max(1,e.runs.length),i=0;for(let a=0;a<e.pageCount;a+=1){let o=e.pageRunStarts[a],s=o+e.pageRunCounts[a],c=t.length,l=o;for(;l<s;){let n=e.runs[l],o=n.eligible,c=l,u=0,d=0,f=null,p=0,m=0,h=ba(n,2),g=ba(n,0);for(;l<s;){let t=e.runs[l];if(t.eligible!==o||u+t.exactCount>512||o&&d+1>12)break;let n=La(f,t.bounds),r=p+Ra(t.bounds);if(l>c&&Ra(n)>Math.max(W,r)*4)break;f=n,p=r,u+=t.exactCount,d+=+!!t.eligible,m=Math.max(m,t.maxInkHeight),h=xa(h,ba(t,2)),g=xa(g,ba(t,0)),l+=1}t.push(Object.freeze({pageIndex:a,runStart:c,runCount:l-c,exactStart:n.exactStart,exactCount:u,coarseStart:o?n.coarseIndex:-1,coarseCount:d,bounds:Object.freeze(f??Na(e.scene,a)),maxInkHeight:m,inkHeightDirection:h,baselineDirection:g,eligible:o})),i+=1,i>=256&&(i=0,yield Math.min(1,l/r))}let u=e.scene.pageTextRanges[a*2],d=e.scene.pageTextRanges[a*2+1],f=0,p=0,m=t[c]?.inkHeightDirection,h=t[c]?.baselineDirection,g=t.length>c,_=Na(e.scene,a);for(let e=c;e<t.length;e+=1)f+=t[e].coarseCount,p=Math.max(p,t[e].maxInkHeight),m=xa(m,t[e].inkHeightDirection),h=xa(h,t[e].baselineDirection),g&&=t[e].eligible,_=La(_,t[e].bounds);n.push(Object.freeze({pageIndex:a,clusterStart:c,clusterCount:t.length-c,exactStart:u,exactCount:d,coarseCount:f,bounds:Object.freeze(_),maxInkHeight:p,inkHeightDirection:m,baselineDirection:h,eligible:g})),(i>0||(a+1)%32==0)&&(i=0,yield Math.max(Math.min(1,(a+1)/Math.max(1,e.pageCount)),Math.min(1,s/r)))}return{clusters:t,pages:n}}function ba(e,t){if(!e.eligible)return;let n=e.transform[t],r=e.transform[t+1],i=Math.hypot(n,r);if(!(i>0)||!Number.isFinite(i))return;let a=n<0||n===0&&r<0?-1:1;return Object.freeze([a*n/i,a*r/i])}function xa(e,t){return e&&t&&e[0]===t[0]&&e[1]===t[1]?e:void 0}function Sa(e,t,n,r,i,a){return Object.freeze({exactInstanceCount:e.instanceCount,coarseInstanceCount:e.coarse.count,combinedInstanceCount:e.instanceCount+e.coarse.count,solidGlyphIndex:Math.max(0,e.scene.textGlyphCount|0),runs:n,clusters:Object.freeze(t.clusters),pages:Object.freeze(t.pages),coarseInstanceA:r,coarseInstanceB:i,coarseInstanceC:a})}function Ca(e,t){let{scene:n}=e,r=t*4;if((n.textInstanceB[r+3]??0)>0)return null;let i=n.textInstanceA[r],a=n.textInstanceA[r+1],o=n.textInstanceA[r+2],s=n.textInstanceA[r+3],c=n.textInstanceB[r],l=n.textInstanceB[r+1],u=Math.trunc(n.textInstanceB[r+2]),d=n.textInstanceC[r],f=n.textInstanceC[r+1],p=n.textInstanceC[r+2],m=n.textInstanceC[r+3];if(![i,a,o,s,c,l,d,f,p,m].every(Number.isFinite))return null;let h=i*s-a*o,g=Math.max(0,n.textGlyphCount|0);if(Math.abs(h)<=1e-12||u<0||u>=g)return null;let _=u*4;if(_+3>=n.textGlyphMetaA.length||_+1>=n.textGlyphMetaB.length)return null;let v=n.textGlyphMetaA[_+2],y=n.textGlyphMetaA[_+3],b=n.textGlyphMetaB[_],x=n.textGlyphMetaB[_+1],S=x-y,C=S*Math.hypot(o,s);return![v,y,b,x,C].every(Number.isFinite)||!(b-v>W)||!(S>W)||!(C>W)?null:{a:i,b:a,c:o,d:s,determinant:h,originX:c,originY:l,minU:v,minV:y,maxU:b,maxV:x,inkArea:e.inkAreas[u]??0,inkHeight:C,red:d,green:f,blue:p,alpha:m}}function wa(e,t){return Math.abs(e.a-t.a)<=ua&&Math.abs(e.b-t.b)<=ua&&Math.abs(e.c-t.c)<=ua&&Math.abs(e.d-t.d)<=ua&&Math.abs(e.red-t.red)<=da&&Math.abs(e.green-t.green)<=da&&Math.abs(e.blue-t.blue)<=da&&Math.abs(e.alpha-t.alpha)<=da}function Ta(e,t,n){if(!(e.pageTextRanges instanceof Uint32Array)||e.pageTextRanges.length<n*2)return!1;let r=0;for(let i=0;i<n;i+=1){let n=e.pageTextRanges[i*2],a=e.pageTextRanges[i*2+1];if(n!==r||a>t-r)return!1;r+=a}return r===t}function Ea(e,t,n,r,i){let a=Oa(e,t,r,i);for(let r=0;r<e;r+=1){let e=r*4,i=(n[e]-t[e+2])*(n[e+1]-t[e+3]);n[e+2]=i>0&&Number.isFinite(i)?Math.min(1,a[r]/i):0}}function Da(e){return Oa(Math.max(0,e.textGlyphCount|0),e.textGlyphMetaA,e.textGlyphSegmentsA,e.textGlyphSegmentsB)}function Oa(e,t,n,r){let i=new Float32Array(e);for(let a=0;a<e;a+=1){let e=a*4,o=Math.max(0,Math.trunc(t[e]??0)),s=Math.max(0,Math.trunc(t[e+1]??0)),c=0,l=!1,u=0,d=0,f=0,p=0;for(let e=0;e<s;e+=1){let t=(o+e)*4;if(t+3>=n.length||t+3>=r.length)break;let i=n[t],a=n[t+1],s=n[t+2],m=n[t+3],h=r[t],g=r[t+1],_=r[t+2];[i,a,s,m,h,g,_].every(Number.isFinite)&&((!l||!Ua(i,a,f,p))&&(l&&(c+=f*d-p*u),l=!0,u=i,d=a),c+=_>=.5?2/3*(i*m-a*s)+1/3*(i*g-a*h)+2/3*(s*g-m*h):i*g-a*h,f=h,p=g)}l&&(c+=f*d-p*u),i[a]=Math.abs(c)*.5}return i}var ka=class{capacity;a;b;c;count=0;constructor(e){this.capacity=Math.max(16,e),this.a=new Float32Array(this.capacity*4),this.b=new Float32Array(this.capacity*4),this.c=new Float32Array(this.capacity*4)}push(e,t,n,r,i,a,o,s,c,l,u,d){this.count>=this.capacity&&this.grow();let f=this.count*4;this.a.set([e,t,n,r],f),this.b.set([i,a,o,s],f),this.c.set([c,l,u,d],f),this.count+=1}trimA(){return this.a.slice(0,this.count*4)}trimB(){return this.b.slice(0,this.count*4)}trimC(){return this.c.slice(0,this.count*4)}grow(){this.capacity*=2,this.a=Ha(this.a,this.capacity*4),this.b=Ha(this.b,this.capacity*4),this.c=Ha(this.c,this.capacity*4)}};function Aa(e,t,n){return Object.freeze({data:e,fallbackReason:t,buildTimeMs:Math.max(0,n)})}function ja(e,t){if(e instanceof RangeError&&/allocation failed|array buffer|invalid (?:typed )?array length|out of memory|length too large|maximum array/i.test(e.message))return Aa(null,`resource-capacity`,Wa()-t);throw e}function Ma(e){return Object.freeze({...e,bounds:Object.freeze(za(e.bounds)),transform:Object.freeze([...e.transform])})}function Na(e,t){let n=t*4;if(n+3<e.pageRects.length){let t=e.pageRects[n],r=e.pageRects[n+1],i=e.pageRects[n+2],a=e.pageRects[n+3],o={minX:Math.min(t,i),minY:Math.min(r,a),maxX:Math.max(t,i),maxY:Math.max(r,a)};if(Ba(o))return o}return Ba(e.bounds)?za(e.bounds):{minX:0,minY:0,maxX:0,maxY:0}}function Pa(e,t,n){let r=t*4,i=e.textInstanceA[r],a=e.textInstanceA[r+1],o=e.textInstanceA[r+2],s=e.textInstanceA[r+3],c=e.textInstanceB[r],l=e.textInstanceB[r+1],u=Math.trunc(e.textInstanceB[r+2]),d=u*4;if([i,a,o,s,c,l].every(Number.isFinite)&&u>=0&&d+3<e.textGlyphMetaA.length&&d+1<e.textGlyphMetaB.length){let t=e.textGlyphMetaA[d+2],n=e.textGlyphMetaA[d+3],r=e.textGlyphMetaB[d],u=e.textGlyphMetaB[d+1];if([t,n,r,u].every(Number.isFinite))return Ia([i*(r-t),a*(r-t),o*(u-n),s*(u-n),i*t+o*n+c,a*t+s*n+l])}return za(n)}function Fa(e,t,n,r){let i=null;for(let a=t;a<n;a+=1)i=La(i,Pa(e,a,r));return i??za(r)}function Ia(e){let[t,n,r,i,a,o]=e,s=a,c=o,l=t+a,u=n+o,d=r+a,f=i+o,p=t+r+a,m=n+i+o;return{minX:Math.min(s,l,d,p),minY:Math.min(c,u,f,m),maxX:Math.max(s,l,d,p),maxY:Math.max(c,u,f,m)}}function La(e,t){return e?{minX:Math.min(e.minX,t.minX),minY:Math.min(e.minY,t.minY),maxX:Math.max(e.maxX,t.maxX),maxY:Math.max(e.maxY,t.maxY)}:za(t)}function Ra(e){return Math.max(0,e.maxX-e.minX)*Math.max(0,e.maxY-e.minY)}function za(e){return{minX:e.minX,minY:e.minY,maxX:e.maxX,maxY:e.maxY}}function Ba(e){return Number.isFinite(e.minX)&&Number.isFinite(e.minY)&&Number.isFinite(e.maxX)&&Number.isFinite(e.maxY)&&e.maxX>=e.minX&&e.maxY>=e.minY}function Va(e,t){if(t.exactInstanceCount!==Math.max(0,e.textInstanceCount|0)||t.solidGlyphIndex!==Math.max(0,e.textGlyphCount|0)||t.combinedInstanceCount!==t.exactInstanceCount+t.coarseInstanceCount)throw Error(`Text LOD build data does not belong to this scene.`)}function G(e,t,n){if(e.length<t*4)throw RangeError(`${n} requires at least ${t*4} floats.`)}function Ha(e,t){let n=new Float32Array(t);return n.set(e),n}function Ua(e,t,n,r){return Math.abs(e-n)<=fa&&Math.abs(t-r)<=fa}function Wa(){return typeof performance<`u`&&typeof performance.now==`function`?performance.now():Date.now()}const Ga=new Float32Array([1,1,0,0]),Ka=new Float32Array([0,0,0,0,1,0,0,0,1,1,0,0,0,1,0,0]),qa=new Float32Array([1,0,0,0,1,1,0,0,0,1,0,0,0,0,0,0]),Ja=1e-8;function Ya(e,t,n,r){if(!Number.isFinite(e)||!Number.isFinite(t)||!Number.isFinite(n)||!Number.isFinite(r))return 1/0;let i=e*e+t*t+n*n+r*r,a=e*r-t*n,o=Math.max(0,i*i-4*a*a);return Math.sqrt(Math.max(0,(i+Math.sqrt(o))*.5))}function Xa(e,t,n,r,i){let a=Math.max(1,Math.abs(r)),o=Math.max(1,Math.abs(i)),s=Number.isFinite(n)?n:0,c=2*s/a,l=2*s/o;return new Float64Array([c,0,0,0,0,l,0,0,0,0,1,0,-e*c,-t*l,0,1])}function Za(){return{visible:!0,stable:!1,maxPixelsPerLocalUnit:1/0,minPixelsPerLocalUnit:0,minX:-1/0,minY:-1/0,maxX:1/0,maxY:1/0}}function Qa(e,t,n,r,i,a){let o=Math.max(1,n.width),s=Math.max(1,n.height);if(!ro(e)||t.length<16||!Number.isFinite(o)||!Number.isFinite(s))return io(r);let c=t[0],l=t[1],u=t[3],d=t[4],f=t[5],p=t[7],m=t[12],h=t[13],g=t[15];if(!Number.isFinite(c)||!Number.isFinite(l)||!Number.isFinite(u)||!Number.isFinite(d)||!Number.isFinite(f)||!Number.isFinite(p)||!Number.isFinite(m)||!Number.isFinite(h)||!Number.isFinite(g))return io(r);let _=1/0,v=-1/0,y=1/0,b=1/0,x=1/0,S=-1/0,C=-1/0,w=!0,T=!0,E=!0,D=!0;for(let t=0;t<4;t+=1){let n=t&1?e.maxX:e.minX,i=t&2?e.maxY:e.minY,a=c*n+d*i+m,O=l*n+f*i+h,k=u*n+p*i+g;if(!Number.isFinite(a)||!Number.isFinite(O)||!Number.isFinite(k))return io(r);if(_=Math.min(_,k),v=Math.max(v,k),y=Math.min(y,Math.abs(k)),w&&=a<-k,T&&=a>k,E&&=O<-k,D&&=O>k,Math.abs(k)>Ja){let e=(a/k*.5+.5)*o,t=(O/k*.5+.5)*s;if(!Number.isFinite(e)||!Number.isFinite(t))return io(r);b=Math.min(b,e),x=Math.min(x,t),S=Math.max(S,e),C=Math.max(C,t)}}if(v<-1e-8)return ao(r);if(_<=Ja||y<=Ja)return io(r);let O=!(w||T||E||D),k=$a(t),A,j;if(k){if(A=i?Math.hypot((c*i[0]+d*i[1])*o*.5/g,(l*i[0]+f*i[1])*s*.5/g):eo(t,o,s),i&&a){let e=(c*a[0]+d*a[1])*o*.5/g,t=(l*a[0]+f*a[1])*s*.5/g,n=(c*i[0]+d*i[1])*o*.5/g,r=(l*i[0]+f*i[1])*s*.5/g,u=Math.hypot(e,t);u>0&&(A=Math.abs(e*r-t*n)/u)}j=A}else{let t=o*.5,n=s*.5,r=0,b=1/0,x=-1/0,S=1/0,C=-1/0,w=0,T=0,E=1/0,D=-1/0,O=1/0,k=-1/0,M=1/0,N=-1/0,P=1/0,F=-1/0;for(let o=0;o<4;o+=1){let s=o&1?e.maxX:e.minX,_=o&2?e.maxY:e.minY,v=c*s+d*_+m,y=l*s+f*_+h,A=u*s+p*_+g,j=(c*A-v*u)*t,I=(l*A-y*u)*n,L=(d*A-v*p)*t,R=(f*A-y*p)*n;if(i&&a){let e=j*a[0]+L*a[1],t=I*a[0]+R*a[1];b=Math.min(b,e),x=Math.max(x,e),S=Math.min(S,t),C=Math.max(C,t),w=Math.max(w,Math.hypot(e,t))}i?(j=j*i[0]+L*i[1],I=I*i[0]+R*i[1],L=R=0,r=Math.max(r,Math.hypot(j,I))):r=Math.max(r,Ya(j,I,L,R)),T=Math.max(T,A*A),E=Math.min(E,j),D=Math.max(D,j),O=Math.min(O,I),k=Math.max(k,I),M=Math.min(M,L),N=Math.max(N,L),P=Math.min(P,R),F=Math.max(F,R)}A=r/(y*y);let I=Math.max(no(E,D),no(O,k),no(M,N),no(P,F));if(j=T>0?I/T:0,i&&a){let e=c*(f*g-h*p)-d*(l*g-h*u)+m*(l*p-f*u),r=Math.abs(e*(a[0]*i[1]-a[1]*i[0]))*t*n,o=Math.hypot(no(b,x),no(S,C));o>0&&(A=Math.min(A,r/(_*o))),j=w>0?r/(v*w):0}}return Number.isFinite(A)?(r.visible=O,r.stable=!0,r.maxPixelsPerLocalUnit=A,r.minPixelsPerLocalUnit=Number.isFinite(j)?Math.min(j,A):0,r.minX=b,r.minY=x,r.maxX=S,r.maxY=C,r):io(r)}function $a(e){return e.length>=16&&Math.abs(e[3])<=2**-52&&Math.abs(e[7])<=2**-52}function eo(e,t,n){let r=1/e[15];return Ya(e[0]*r*t*.5,e[1]*r*n*.5,e[4]*r*t*.5,e[5]*r*n*.5)}function to(e,t){if(!$a(e))return null;let n=e[0],r=e[1],i=e[4],a=e[5],o=e[12],s=e[13],c=e[15],l=n*a-i*r;if(![n,r,i,a,o,s,c,l].every(Number.isFinite)||c<=Ja||Math.abs(l)<=2**-52*Math.max(n*n+r*r,i*i+a*a))return null;let u=1/0,d=1/0,f=-1/0,p=-1/0;for(let e=0;e<4;e+=1){let t=(e&1?c:-c)-o,m=(e&2?c:-c)-s,h=(a*t-i*m)/l,g=(n*m-r*t)/l;u=Math.min(u,h),d=Math.min(d,g),f=Math.max(f,h),p=Math.max(p,g)}return[u,d,f,p].every(Number.isFinite)?(t.minX=u,t.minY=d,t.maxX=f,t.maxY=p,t):null}function no(e,t){return e>0?e:t<0?-t:0}function ro(e){return Number.isFinite(e.minX)&&Number.isFinite(e.minY)&&Number.isFinite(e.maxX)&&Number.isFinite(e.maxY)&&e.maxX>=e.minX&&e.maxY>=e.minY}function io(e){return e.visible=!0,e.stable=!1,e.maxPixelsPerLocalUnit=1/0,e.minPixelsPerLocalUnit=0,e.minX=-1/0,e.minY=-1/0,e.maxX=1/0,e.maxY=1/0,e}function ao(e){return e.visible=!1,e.stable=!0,e.maxPixelsPerLocalUnit=0,e.minPixelsPerLocalUnit=0,e.minX=0,e.minY=0,e.maxX=0,e.maxY=0,e}const oo=.5,so=.75,co=.1,lo=/* @__PURE__ */ new WeakMap;function uo(e){return lo.get(e)??null}function fo(e){let t=lo.get(e);if(t)return t;let n=pa(e);return lo.set(e,n),n}var po=class{data;buildTimeMs;buildFallbackReason;resourceFallbackReason=null;mode;clusterStates;clusterVisibility;selectedInstanceIds=/* @__PURE__ */ new Uint32Array;exactIdentityInstanceIds=null;selectionScratch=/* @__PURE__ */ new Uint32Array;selectionInitialized=!1;lastUpdateValid=!1;lastPageMatrices;lastPageRevision;lastPageOffsets;lastPageEnabled;lastPageLayoutRevision;lastLocalToClip=/* @__PURE__ */ new Float64Array(16);lastViewportWidth=0;lastViewportHeight=0;lastHasCullingBounds=!1;lastCullingBounds=/* @__PURE__ */ new Float64Array(4);selectionUploads=0;stats;pageProjection=Za();clusterProjection=Za();selectionViewportScratch={width:1,height:1};visibilityBounds={minX:0,minY:0,maxX:0,maxY:0};pageVisibilityBounds={minX:0,minY:0,maxX:0,maxY:0};affineViewBounds={minX:0,minY:0,maxX:0,maxY:0};affineVisibility={minX:0,minY:0,maxX:0,maxY:0};affineScale=0;lastAffineValid=!1;lastAffineScale=0;affineBasis=/* @__PURE__ */ new Float64Array(4);lastAffineBasis=/* @__PURE__ */ new Float64Array(4);lastAffineVisibility=/* @__PURE__ */ new Float64Array(4);constructor(e,t=`auto`){this.data=e.data,this.buildTimeMs=e.buildTimeMs,this.buildFallbackReason=e.fallbackReason,this.mode=t,this.clusterStates=new Uint8Array(e.data?.clusters.length??0),this.clusterVisibility=new Uint8Array(e.data?.clusters.length??0),this.stats=this.createEmptyStats()}setMode(e){if(e!==`auto`&&e!==`off`)throw RangeError(`Unsupported Text LOD mode: ${String(e)}`);e!==this.mode&&(this.mode=e,e===`off`&&this.clusterStates.fill(0),this.selectionInitialized=!1,this.lastUpdateValid=!1,this.lastAffineValid=!1,this.stats=this.createEmptyStats())}getMode(){return this.mode}setResourceFallback(e){let t=e&&e.length>0?e:null;t!==this.resourceFallbackReason&&(this.resourceFallbackReason=t,this.selectionInitialized=!1,this.lastUpdateValid=!1,this.lastAffineValid=!1,this.stats=this.createEmptyStats())}update(e){let t=this.data;if(!t||this.resourceFallbackReason)return this.finishUnavailableSelection();let n=e.pixelRatio??1;if(Number.isFinite(n)&&n>1&&(e={...e,viewportWidth:e.viewportWidth/n,viewportHeight:e.viewportHeight/n}),this.selectionInitialized&&this.isSameSelectionUpdate(e))return{instanceIds:this.selectedInstanceIds,changed:!1,stats:this.getStats()};let r=e.pageOffsets!==void 0&&this.resolveAffineView(e),i=r?e.pageOffsets:void 0,a=r||!e.pageLocalToClip&&this.resolveAffineView(e);if(a&&this.selectionInitialized&&this.isSameAffineSelection()&&this.isSamePageLayout(e))return this.rememberSelectionUpdate(e),{instanceIds:this.selectedInstanceIds,changed:!1,stats:this.getStats()};let o=!this.selectionInitialized,s=!1,c=0,l=0,u=0,d=0,f=0,p=a?this.affineVisibility:this.resolveVisibilityBounds(e.cullingBounds);for(let n of t.pages){let r=p;if(i&&p){if(e.pageEnabled?.[n.pageIndex]===0){vo(n.clusterStart,n.clusterCount,this.clusterVisibility)&&(s=!0);continue}let t=i[n.pageIndex*2],a=i[n.pageIndex*2+1];r=this.pageVisibilityBounds,r.minX=p.minX-t,r.minY=p.minY-a,r.maxX=p.maxX-t,r.maxY=p.maxY-a}let o=e.pageLocalToClip?.[n.pageIndex]??e.localToClip;if(!i&&e.pageVisibility?.[n.pageIndex]===0||r&&!bo(n.bounds,r)){vo(n.clusterStart,n.clusterCount,this.clusterVisibility)&&(s=!0);continue}let m=a?null:Qa(n.bounds,o,this.selectionViewport(e),this.pageProjection,n.inkHeightDirection,n.baselineDirection);if(m&&m.stable&&!m.visible){vo(n.clusterStart,n.clusterCount,this.clusterVisibility)&&(s=!0);continue}let h=!m||m.stable,g=m?m.maxPixelsPerLocalUnit:this.affineInkHeightScale(n.inkHeightDirection,n.baselineDirection),_=n.eligible&&n.clusterCount>0&&xo(this.clusterStates,n.clusterStart,n.clusterCount,1),v=_?so:oo;if(this.mode===`auto`&&n.eligible&&h&&(_?n.maxInkHeight*g<v:n.maxInkHeight*g<=v)){let e=n.clusterStart+n.clusterCount;for(let r=n.clusterStart;r<e;r+=1){let e=t.clusters[r];yo(this.clusterVisibility,r,1)&&(s=!0),yo(this.clusterStates,r,1)&&(s=!0),c+=1,u+=1,f+=e.coarseCount}continue}let y=m!==null&&m.stable&&go(m,e),b=n.clusterStart+n.clusterCount;for(let i=n.clusterStart;i<b;i+=1){let a=t.clusters[i];if(r&&!bo(a.bounds,r)){yo(this.clusterVisibility,i,0)&&(s=!0);continue}let p=this.clusterStates[i]===1,h=this.mode===`auto`&&a.eligible,g=-1;if(m?y&&(h?ho(a.maxInkHeight*m.maxPixelsPerLocalUnit,p)?g=1:(n.inkHeightDirection||!a.inkHeightDirection)&&(n.baselineDirection||!a.baselineDirection)&&a.maxInkHeight*m.minPixelsPerLocalUnit>=.75&&(g=0):g=0):g=h&&ho(a.maxInkHeight*this.affineInkHeightScale(a.inkHeightDirection,a.baselineDirection),p)?1:0,g<0){let t=Qa(a.bounds,o,this.selectionViewport(e),this.clusterProjection,a.inkHeightDirection,a.baselineDirection);if(t.stable&&!t.visible){yo(this.clusterVisibility,i,0)&&(s=!0);continue}g=h&&t.stable&&ho(a.maxInkHeight*t.maxPixelsPerLocalUnit,p)?1:0}yo(this.clusterVisibility,i,1)&&(s=!0),c+=1;let _=g===1;yo(this.clusterStates,i,+!!_)&&(s=!0),_?(u+=1,f+=a.coarseCount):(l+=1,d+=a.exactCount)}}let m=o||s;return m&&(this.selectedInstanceIds=this.buildSelectedInstanceIds(t,c===t.clusters.length&&u===0&&d===t.exactInstanceCount),this.selectionUploads+=1,this.selectionInitialized=!0),this.stats={mode:this.mode,available:!0,fallbackReason:null,buildTimeMs:this.buildTimeMs,totalRuns:t.runs.length,totalClusters:t.clusters.length,visibleClusters:c,exactClusters:l,coarseClusters:u,renderedGlyphs:d,renderedRuns:f,selectedInstances:this.selectedInstanceIds.length,selectionUploads:this.selectionUploads,exactBudgetOverage:Math.max(0,d-2e5)},this.rememberSelectionUpdate(e),this.rememberAffineSelection(a),{instanceIds:this.selectedInstanceIds,changed:m,stats:this.getStats()}}resolveAffineView(e){let t=Math.max(1,e.viewportWidth),n=Math.max(1,e.viewportHeight);if(!Number.isFinite(t)||!Number.isFinite(n))return!1;let r=to(e.localToClip,this.affineViewBounds);if(!r)return!1;let i=eo(e.localToClip,t,n);if(!Number.isFinite(i))return!1;let a=e.pageOffsets?null:e.cullingBounds;a&&(r.minX=Math.max(r.minX,a.minX),r.minY=Math.max(r.minY,a.minY),r.maxX=Math.min(r.maxX,a.maxX),r.maxY=Math.min(r.maxY,a.maxY));let o=this.lastAffineValid&&i===this.lastAffineScale?this.resolveVisibilityBounds(r)??r:r,s=this.affineVisibility;s.minX=o.minX,s.minY=o.minY,s.maxX=o.maxX,s.maxY=o.maxY,this.affineScale=i;let c=e.localToClip,l=c[15];return this.affineBasis[0]=c[0]/l*t*.5,this.affineBasis[1]=c[1]/l*n*.5,this.affineBasis[2]=c[4]/l*t*.5,this.affineBasis[3]=c[5]/l*n*.5,!0}affineInkHeightScale(e,t){if(!e)return this.affineScale;let n=this.affineBasis,r=n[0]*e[0]+n[2]*e[1],i=n[1]*e[0]+n[3]*e[1];if(t){let e=n[0]*t[0]+n[2]*t[1],a=n[1]*t[0]+n[3]*t[1],o=Math.hypot(e,a);if(o>0)return Math.abs(e*i-a*r)/o}return Math.hypot(r,i)}isSamePageLayout(e){return this.lastPageOffsets===e.pageOffsets&&this.lastPageEnabled===e.pageEnabled&&this.lastPageLayoutRevision===e.pageLayoutRevision&&(e.pageOffsets===void 0||e.pageLayoutRevision!==void 0)}isSameAffineSelection(){let e=this.affineVisibility;return this.lastAffineValid&&this.affineScale===this.lastAffineScale&&this.affineBasis[0]===this.lastAffineBasis[0]&&this.affineBasis[1]===this.lastAffineBasis[1]&&this.affineBasis[2]===this.lastAffineBasis[2]&&this.affineBasis[3]===this.lastAffineBasis[3]&&e.minX===this.lastAffineVisibility[0]&&e.minY===this.lastAffineVisibility[1]&&e.maxX===this.lastAffineVisibility[2]&&e.maxY===this.lastAffineVisibility[3]}rememberAffineSelection(e){this.lastAffineValid=e,e&&(this.lastAffineScale=this.affineScale,this.lastAffineBasis.set(this.affineBasis),this.lastAffineVisibility[0]=this.affineVisibility.minX,this.lastAffineVisibility[1]=this.affineVisibility.minY,this.lastAffineVisibility[2]=this.affineVisibility.maxX,this.lastAffineVisibility[3]=this.affineVisibility.maxY)}resolveVisibilityBounds(e){if(!e)return null;let t=mo((e.maxX-e.minX)*co),n=mo((e.maxY-e.minY)*co);if(t<=0||n<=0)return e;let r=this.visibilityBounds;return r.minX=Math.floor(e.minX/t)*t,r.minY=Math.floor(e.minY/n)*n,r.maxX=Math.ceil(e.maxX/t)*t,r.maxY=Math.ceil(e.maxY/n)*n,r}selectionViewport(e){return this.selectionViewportScratch.width=e.viewportWidth,this.selectionViewportScratch.height=e.viewportHeight,this.selectionViewportScratch}getSelectedInstanceIds(){return this.selectedInstanceIds}getStats(){return{...this.stats}}dispose(){this.data=null,this.clusterStates=/* @__PURE__ */ new Uint8Array,this.clusterVisibility=/* @__PURE__ */ new Uint8Array,this.selectedInstanceIds=/* @__PURE__ */ new Uint32Array,this.exactIdentityInstanceIds=null,this.selectionScratch=/* @__PURE__ */ new Uint32Array,this.selectionInitialized=!1,this.lastUpdateValid=!1,this.lastAffineValid=!1,this.stats=this.createEmptyStats()}finishUnavailableSelection(){let e=this.selectedInstanceIds.length!==0;return e&&(this.selectedInstanceIds=/* @__PURE__ */ new Uint32Array,this.selectionUploads+=1),this.selectionInitialized=!0,this.stats=this.createEmptyStats(),{instanceIds:this.selectedInstanceIds,changed:e,stats:this.getStats()}}createEmptyStats(){return{mode:this.mode,available:this.data!==null&&this.resourceFallbackReason===null,fallbackReason:this.resourceFallbackReason??this.buildFallbackReason,buildTimeMs:this.buildTimeMs,totalRuns:this.data?.runs.length??0,totalClusters:this.data?.clusters.length??0,visibleClusters:0,exactClusters:0,coarseClusters:0,renderedGlyphs:0,renderedRuns:0,selectedInstances:0,selectionUploads:this.selectionUploads,exactBudgetOverage:0}}buildSelectedInstanceIds(e,t){let n=this.ensureIdentityInstanceIds(e);if(t)return n.subarray(0,e.exactInstanceCount);this.selectionScratch.length<e.combinedInstanceCount&&(this.selectionScratch=new Uint32Array(e.combinedInstanceCount));let r=this.selectionScratch,i=0,a=0,o=0;for(let t=0;t<e.clusters.length;t+=1){if(this.clusterVisibility[t]===0)continue;let s=e.clusters[t],c=this.clusterStates[t]===1?e.exactInstanceCount+s.coarseStart:s.exactStart,l=this.clusterStates[t]===1?s.coarseCount:s.exactCount;if(!(l<=0)){if(c===o){o+=l;continue}i=_o(r,i,n,a,o),a=c,o=c+l}}return i=_o(r,i,n,a,o),r.subarray(0,i)}ensureIdentityInstanceIds(e){let t=this.exactIdentityInstanceIds;if(!t||t.length<e.combinedInstanceCount){t=new Uint32Array(e.combinedInstanceCount);for(let e=0;e<t.length;e+=1)t[e]=e;this.exactIdentityInstanceIds=t}return t}isSameSelectionUpdate(e){if(!this.lastUpdateValid||e.localToClip.length<16||this.lastPageMatrices!==e.pageLocalToClip||this.lastPageRevision!==e.pageRevision||e.pageLocalToClip&&e.pageRevision===void 0||!this.isSamePageLayout(e)||Number(e.viewportWidth)!==this.lastViewportWidth||Number(e.viewportHeight)!==this.lastViewportHeight)return!1;if(!e.pageLocalToClip||e.pageOffsets){for(let t=0;t<16;t+=1)if(Number(e.localToClip[t])!==this.lastLocalToClip[t])return!1}let t=e.cullingBounds;return t!=null===this.lastHasCullingBounds?!t||t.minX===this.lastCullingBounds[0]&&t.minY===this.lastCullingBounds[1]&&t.maxX===this.lastCullingBounds[2]&&t.maxY===this.lastCullingBounds[3]:!1}rememberSelectionUpdate(e){if(this.lastPageMatrices=e.pageLocalToClip,this.lastPageRevision=e.pageRevision,this.lastPageOffsets=e.pageOffsets,this.lastPageEnabled=e.pageEnabled,this.lastPageLayoutRevision=e.pageLayoutRevision,e.localToClip.length<16){this.lastUpdateValid=!1;return}for(let t=0;t<16;t+=1)this.lastLocalToClip[t]=Number(e.localToClip[t]);this.lastViewportWidth=Number(e.viewportWidth),this.lastViewportHeight=Number(e.viewportHeight);let t=e.cullingBounds;this.lastHasCullingBounds=t!=null,t&&(this.lastCullingBounds[0]=t.minX,this.lastCullingBounds[1]=t.minY,this.lastCullingBounds[2]=t.maxX,this.lastCullingBounds[3]=t.maxY),this.lastUpdateValid=!0}};function mo(e){return!Number.isFinite(e)||e<=0?0:2**Math.round(Math.log2(e))}function ho(e,t){return t?e<so:e<=oo}function go(e,t){return e.minX>=0&&e.minY>=0&&e.maxX<=Math.max(1,t.viewportWidth)&&e.maxY<=Math.max(1,t.viewportHeight)}function _o(e,t,n,r,i){let a=i-r;if(a<=0)return t;if(a>=64)e.set(n.subarray(r,i),t);else for(let n=r;n<i;n+=1)e[t+n-r]=n;return t+a}function vo(e,t,n){let r=Math.min(n.length,e+t),i=!1;for(let t=e;t<r;t+=1)n[t]!==0&&(n[t]=0,i=!0);return i}function yo(e,t,n){return e[t]!==n&&(e[t]=n,!0)}function bo(e,t){return e.maxX>=t.minX&&e.minX<=t.maxX&&e.maxY>=t.minY&&e.minY<=t.maxY}function xo(e,t,n,r){let i=Math.min(e.length,t+n);for(let n=t;n<i;n+=1)if(e[n]!==r)return!1;return i-t===n}function So(e){let t=e?Math.floor(e.count):0,n=e&&Number.isFinite(t)?Math.min(Math.max(0,t),Math.floor(e.rects.length/4)):0;if(!e||n===0)return null;let r=Math.floor(e.currentIndex),i=r>=0&&r<n?r:-1,a=Math.floor(e.currentCount??1),o=i>=0?Math.min(Number.isFinite(a)?Math.max(1,a):1,n-i):0,s=i+o,c=n-o,l=new Float32Array(c*4),u=0;for(let t=0;t<n;t+=1)t>=i&&t<s||(l.set(e.rects.subarray(t*4,t*4+4),u*4),u+=1);return{otherRects:l,otherCount:c,currentRects:o>0?e.rects.slice(i*4,s*4):/* @__PURE__ */ new Float32Array,currentCount:o}}const Co=[1,.85,.7,.55,.4,.3],wo=.001,To=/* @__PURE__ */ new WeakMap;function Eo(e){let t=To,n;for(let r of[e.textGlyphSegmentsA,e.textGlyphSegmentsB,e.textGlyphMetaA,e.textGlyphMetaB])n=t.get(r),n||(n={next:/* @__PURE__ */ new WeakMap,atlases:/* @__PURE__ */ new Map},t.set(r,n)),t=n.next;return n.atlases}function Do(e,t){if(typeof document>`u`||e.textGlyphCount<=0)return null;let n=No(Math.trunc(t)||4096,256,4096),r=Eo(e),i=r.get(e.textGlyphCount)?.get(n);if(i)return i;let a=new Float32Array(e.textGlyphCount*4),o=null;for(let t of Co){let r=Oo(e,Math.max(8,Math.round(96*t)));if(r.length===0)return null;let i=ko(r,n);if(i){o=i;break}}if(!o)return null;let s=document.createElement(`canvas`);s.width=o.width,s.height=o.height;let c=s.getContext(`2d`,{alpha:!0,willReadFrequently:!0});if(!c)return null;c.setTransform(1,0,0,1,0,0),c.clearRect(0,0,o.width,o.height),c.fillStyle=`#ffffff`,c.globalCompositeOperation=`source-over`;for(let t of o.placements){if(!Ao(c,t,e))continue;c.fill(`nonzero`);let n=t.index*4;a[n]=(t.x+8)/o.width,a[n+1]=(t.y+8)/o.height,a[n+2]=t.innerWidth/o.width,a[n+3]=t.innerHeight/o.height}let l=c.getImageData(0,0,o.width,o.height),u=new Uint8Array(o.width*o.height);for(let e=0,t=0;t<u.length;e+=4,t+=1)u[t]=l.data[e+3];let d={width:o.width,height:o.height,alpha:u,glyphUvRects:a},f=r.get(e.textGlyphCount)??/* @__PURE__ */ new Map;return f.set(n,d),r.set(e.textGlyphCount,f),d}function Oo(e,t){let n=[];for(let r=0;r<e.textGlyphCount;r+=1){let i=r*4,a=Math.max(0,Math.trunc(e.textGlyphMetaA[i])),o=Math.max(0,Math.trunc(e.textGlyphMetaA[i+1]));if(o<=0)continue;let s=e.textGlyphMetaA[i+2],c=e.textGlyphMetaA[i+3],l=e.textGlyphMetaB[i],u=e.textGlyphMetaB[i+1],d=l-s,f=u-c;if(!Number.isFinite(d)||!Number.isFinite(f)||d<=1e-6||f<=1e-6)continue;let p=t/Math.max(d,f),m=No(Math.ceil(d*p),8,256),h=No(Math.ceil(f*p),8,256);n.push({index:r,segmentStart:a,segmentCount:o,minX:s,minY:c,maxX:l,maxY:u,innerWidth:m,innerHeight:h,tileWidth:m+16,tileHeight:h+16,x:0,y:0})}return n}function ko(e,t){if(e.length===0)return null;let n=e.slice().sort((e,t)=>e.tileHeight===t.tileHeight?t.tileWidth-e.tileWidth:t.tileHeight-e.tileHeight),r=n.reduce((e,t)=>e+t.tileWidth*t.tileHeight,0),i=n.reduce((e,t)=>Math.max(e,t.tileWidth),0),a=No(Mo(Math.ceil(Math.sqrt(r)*1.15)),i,t);for(;a<=t;){let e=0,r=0,i=0,o=!1;for(let s of n){if(s.tileWidth>a){o=!0;break}if(e+s.tileWidth>a&&(e=0,r+=i,i=0),s.x=e,s.y=r,e+=s.tileWidth,i=Math.max(i,s.tileHeight),r+i>t){o=!0;break}}if(!o){let e=r+i,o=No(Mo(Math.max(e,1)),1,t);if(o<=t)return{placements:n,width:a,height:o}}if(a===t)break;a=Math.min(t,a*2)}return null}function Ao(e,t,n){let r=Math.max(t.maxX-t.minX,1e-6),i=Math.max(t.maxY-t.minY,1e-6),a=t.innerWidth/r,o=t.innerHeight/i,s=t.x+8-t.minX*a,c=t.y+8+t.maxY*o,l=e=>s+e*a,u=e=>c-e*o;e.beginPath();let d=!1,f=!1,p=0,m=0,h=0,g=0;for(let r=0;r<t.segmentCount;r+=1){let i=(t.segmentStart+r)*4;if(i+3>=n.textGlyphSegmentsA.length||i+3>=n.textGlyphSegmentsB.length)break;let a=n.textGlyphSegmentsA[i],o=n.textGlyphSegmentsA[i+1],s=n.textGlyphSegmentsA[i+2],c=n.textGlyphSegmentsA[i+3],_=n.textGlyphSegmentsB[i],v=n.textGlyphSegmentsB[i+1],y=n.textGlyphSegmentsB[i+2];(!f||!jo(a,o,h,g))&&(f&&e.closePath(),e.moveTo(l(a),u(o)),f=!0,p=a,m=o),y>=.5?e.quadraticCurveTo(l(s),u(c),l(_),u(v)):e.lineTo(l(_),u(v)),d=!0,h=_,g=v,jo(h,g,p,m)&&(e.closePath(),f=!1)}return f&&e.closePath(),d}function jo(e,t,n,r){return Math.abs(e-n)<=wo&&Math.abs(t-r)<=wo}function Mo(e){if(e<=1)return 1;let t=1;for(;t<e;)t<<=1;return t}function No(e,t,n){return e<t?t:e>n?n:e}const Po=Math.PI/720,Fo=4095;var Io=class{tuple;size=0;arity;keys;keySlots;slots;pendingSlot=-1;hashValue=/* @__PURE__ */ new Float64Array(1);hashWords=new Uint32Array(this.hashValue.buffer);constructor(e,t=1024){this.arity=e,this.tuple=new Float64Array(e),this.keys=new Float64Array(t*e),this.keySlots=new Int32Array(t),this.slots=new Int32Array(t*2)}find(){let e=this.slots.length-1;for(let t=this.hash(this.tuple,0)&e;;t=t+1&e){let e=this.slots[t]-1;if(e<0)return this.pendingSlot=t,-1;if(this.matches(e))return e}}insert(){this.size===this.keySlots.length&&this.growEntries();let e=this.size++;return this.keys.set(this.tuple,e*this.arity),this.keySlots[e]=this.pendingSlot,this.slots[this.pendingSlot]=e+1,this.pendingSlot=-1,this.size*2>this.slots.length&&this.rehash(this.slots.length*2),e}clear(){for(let e=0;e<this.size;e++)this.slots[this.keySlots[e]]=0;this.size=0,this.pendingSlot=-1}matches(e){let t=e*this.arity;for(let e=0;e<this.arity;e++){let n=this.keys[t+e],r=this.tuple[e];if(n!==r&&(n===n||r===r))return!1}return!0}hash(e,t){let n=2166136261;for(let r=0;r<this.arity;r++){let i=e[t+r],a=0,o=2146959360;i===i&&i!==0?(this.hashValue[0]=i,a=this.hashWords[0],o=this.hashWords[1]):i===0&&(o=0),n=Math.imul(n^a,16777619),n=Math.imul(n^o,16777619)}return n^=n>>>16,Math.imul(n,2146121005)>>>0}growEntries(){let e=new Float64Array(this.keys.length*2);e.set(this.keys),this.keys=e;let t=new Int32Array(this.keySlots.length*2);t.set(this.keySlots),this.keySlots=t}rehash(e){this.slots=new Int32Array(e);let t=e-1;for(let e=0;e<this.size;e++){let n=this.hash(this.keys,e*this.arity)&t;for(;this.slots[n]!==0;)n=n+1&t;this.slots[n]=e+1,this.keySlots[e]=n}}},Lo=class{pages=[];width;length=0;constructor(e){this.width=e}append(e,t,n=0){let r=this.length++,i=r>>>12,a=this.pages[i]??(this.pages[i]=new Uint32Array(4096*this.width)),o=(r&Fo)*this.width;return a[o]=e,a[o+1]=t,this.width===3&&(a[o+2]=n),r}get(e,t){return this.pages[e>>>12][(e&Fo)*this.width+t]}set(e,t,n){this.pages[e>>>12][(e&Fo)*this.width+t]=n}clear(){this.length=0,this.pages.length>1&&(this.pages.length=1)}},Ro=class{groupIds=new Io(15);groups=new Lo(3);members=new Lo(2);tolerance;overview;readPrimitive;constructor(e,t,n){this.tolerance=e,this.overview=t,this.readPrimitive=n}get size(){return this.groups.length}add(e,t,n){zo(this.groupIds.tuple,e,n,this.tolerance,this.overview);let r=this.groupIds.find(),i=this.members.append(t,0);r<0?(r=this.groups.append(i+1,i+1,n),this.groupIds.insert()):(this.members.set(this.groups.get(r,1)-1,1,i+1),this.groups.set(r,1,i+1))}*values(){for(let e=0;e<this.groups.length;e++){let t=this.groups.get(e,2),n=this.groups.get(e,0),r;for(;n!==0;){let e=n-1,i=this.readPrimitive(this.members.get(e,0));if(!i)throw Error(`LOD interval source changed during construction`);r??=Bo(i,t,this.tolerance,this.overview);let a=i.x1-i.x0,o=i.y1-i.y0,s=i.x0*r.normalX+i.y0*r.normalY,c=Math.hypot(a,o);r.offsetSum+=s*c,r.offsetWeightSum+=c;let l=i.visibleBounds;l&&(r.clipMinX=Math.min(r.clipMinX,l.minX),r.clipMinY=Math.min(r.clipMinY,l.minY),r.clipMaxX=Math.max(r.clipMaxX,l.maxX),r.clipMaxY=Math.max(r.clipMaxY,l.maxY)),Vo(r,i,this.tolerance),n=this.members.get(e,1)}r&&(yield r)}}clear(){this.groupIds.clear(),this.groups.clear(),this.members.clear()}};function zo(e,t,n,r,i){let a=t.x1-t.x0,o=t.y1-t.y0,s=Math.atan2(o,a);s<0&&(s+=Math.PI),s>=Math.PI&&(s-=Math.PI);let c=Math.round(s/Po);c>=720&&(c=0);let l=c*Po,u=Math.cos(l),d=-Math.sin(l),f=u,p=t.x0*d+t.y0*f,m=!!(t.flags&1),h=!i&&!m&&t.halfWidth>0?Math.min(r,t.halfWidth*.02):r,g=Math.round(p/h),_=m?-1:t.halfWidth,v=t.flags&7,y=t.visibleBounds;e[0]=t.paintGroup??-1,e[1]=n,e[2]=v,e[3]=_,e[4]=Math.round(t.colorR*255),e[5]=Math.round(t.colorG*255),e[6]=Math.round(t.colorB*255),e[7]=Math.round(t.alpha*255),e[8]=c,e[9]=g,e[10]=+!!y,e[11]=y?y.minX:0,e[12]=y?y.minY:0,e[13]=y?y.maxX:0,e[14]=y?y.maxY:0}function Bo(e,t,n,r){let i=e.x1-e.x0,a=e.y1-e.y0,o=Math.atan2(a,i);o<0&&(o+=Math.PI),o>=Math.PI&&(o-=Math.PI);let s=Math.round(o/Po);s>=720&&(s=0);let c=s*Po,l=Math.cos(c),u=Math.sin(c),d=-u,f=l,p=e.x0*d+e.y0*f,m=!!(e.flags&1),h=!r&&!m&&e.halfWidth>0?Math.min(n,e.halfWidth*.02):n,g=Math.round(p/h),_=e.flags&7;return{paintOrder:e.paintOrder,paintGroup:e.paintGroup,tileIndex:t,axisX:l,axisY:u,normalX:d,normalY:f,offset:g*h,offsetSum:0,offsetWeightSum:0,clipMinX:1/0,clipMinY:1/0,clipMaxX:-1/0,clipMaxY:-1/0,halfWidth:e.halfWidth,flags:_,alpha:e.alpha,colorR:e.colorR,colorG:e.colorG,colorB:e.colorB,intervals:[]}}function Vo(e,t,n){let r=t.x0*e.axisX+t.y0*e.axisY,i=t.x1*e.axisX+t.y1*e.axisY,a=Math.min(r,i),o=Math.max(r,i),s=t.visibleBounds;if(s){let r=s.minX*e.axisX+s.minY*e.axisY,i=s.minX*e.axisX+s.maxY*e.axisY,c=s.maxX*e.axisX+s.minY*e.axisY,l=s.maxX*e.axisX+s.maxY*e.axisY,u=Math.max(t.halfWidth*4,n,.001);if(a=Math.max(a,Math.min(r,i,c,l)-u),o=Math.min(o,Math.max(r,i,c,l)+u),o<=a)return}e.intervals.push(a,o)}const Ho=[.5,1,2,4,8,16,32],Uo=5e4;var Wo=class{ids=new Io(15,256);groups=[];get key(){return this.ids.tuple}get size(){return this.groups.length}values(){return this.groups}find(){let e=this.ids.find();return e>=0?this.groups[e]:void 0}add(e){this.ids.insert(),this.groups.push(e)}clear(){this.ids.clear(),this.groups.length=0}};let Go={elapsedMs:0,buildCount:0,sourceSegmentCount:0,levelCount:0};const Ko=/* @__PURE__ */ new WeakMap,qo=16384;var Jo=class{chunks=[];width;length=0;constructor(e){this.width=e}push(e){let t=this.chunkFor(this.length);t[this.length&16383]=e,this.length++}push4(e,t){let n=this.chunkFor(this.length),r=(this.length&16383)*4;n[r]=e[t],n[r+1]=e[t+1],n[r+2]=e[t+2],n[r+3]=e[t+3],this.length++}truncate(e){this.length=Math.min(this.length,e),this.chunks.length=Math.ceil(this.length/qo)}toTypedArray(){let e=new Uint32Array(this.length*this.width),t=qo*this.width;for(let n=0;n<this.chunks.length;n++){let r=n*t;e.set(this.chunks[n].subarray(0,Math.min(t,e.length-r)),r),this.chunks[n]=/* @__PURE__ */ new Uint32Array}return this.chunks.length=0,this.length=0,e}chunkFor(e){let t=e>>>14;return this.chunks[t]??(this.chunks[t]=new Uint32Array(qo*this.width))}};const Yo=[`endpoints`,`primitiveMeta`,`primitiveBounds`,`styles`];var Xo=class{canonicalCount;canonical;canonicalWords;canonicalOrigins;hasOrigins;fields=Yo.map(()=>new Jo(4));literalOrigins;record=/* @__PURE__ */ new Float32Array(16);recordWords=new Uint32Array(this.record.buffer);records=new Jo(1);levelLiteralStart=0;literalCount=0;constructor(e){this.canonical=e,this.canonicalCount=Math.max(0,e.segmentCount|0),this.canonicalWords=Yo.map(t=>{let n=e[t];return new Uint32Array(n.buffer,n.byteOffset,n.length)}),this.canonicalOrigins=ct(e),this.hasOrigins=lt(e),this.literalOrigins=this.hasOrigins?new Jo(1):void 0}get levelRecordCount(){return this.records.length}beginLevel(){this.records=new Jo(1),this.levelLiteralStart=this.literalCount}push(e,t,n,r,i,a){let o=this.record;o[0]=e.x0,o[1]=e.y0,o[2]=e.cx,o[3]=e.cy,o[4]=e.x1,o[5]=e.y1,o[6]=e.primitiveType,o[7]=e.alpha+e.flags*Zo,o[8]=t,o[9]=n,o[10]=r,o[11]=i,o[12]=e.halfWidth,o[13]=e.colorR,o[14]=e.colorG,o[15]=e.colorB;let s=e.paintOrder??0,c=a>=0?a:this.hasOrigins&&e.paintOrder!==void 0?e.paintOrder:-1;if(c>=0&&c<this.canonicalCount&&(!this.hasOrigins||(this.canonicalOrigins?this.canonicalOrigins[c]:c)===s)&&this.matchesCanonical(c)){this.records.push(c);return}for(let e=0;e<Yo.length;e++)this.fields[e].push4(this.recordWords,e*4);this.literalOrigins?.push(s),this.records.push(this.canonicalCount+this.literalCount++)}endLevel(e){if(!e){this.literalCount=this.levelLiteralStart;for(let e of this.fields)e.truncate(this.literalCount);return this.literalOrigins?.truncate(this.literalCount),this.records=new Jo(1),null}let t=this.records.toTypedArray();return this.records=new Jo(1),t}finish(){let e=Object.assign(Object.defineProperties({},Object.getOwnPropertyDescriptors(this.canonical)),{segmentCount:this.literalCount});return Yo.forEach((t,n)=>{e[t]=new Float32Array(this.fields[n].toTypedArray().buffer)}),st(e,this.literalOrigins?.toTypedArray()),e}matchesCanonical(e){let t=this.recordWords,n=e*4;for(let e=0;e<Yo.length;e++){let r=this.canonicalWords[e],i=e*4;if(r[n]!==t[i]||r[n+1]!==t[i+1]||r[n+2]!==t[i+2]||r[n+3]!==t[i+3])return!1}return!0}};const Zo=2,Qo=Math.PI/720,$o=1e-12,es=[0,1,4,5],ts=.1,ns=8192,rs=1.65,is=.25,as=1.1,os=.05;var ss=class{levels;tileGrid;tileSelectedLevelIndices;projectedTileUnitsPerPixel;projectedTileWeights;projectedTileVisibleFractions;projectedTilePartial;projectedPlanes=/* @__PURE__ */ new Float64Array(12);projectedClip=/* @__PURE__ */ new Float64Array(32);projectedTileRect=/* @__PURE__ */ new Float64Array(4);levelTileReach=[];projectedHalfWidth=1;projectedHalfHeight=1;projectedClipCut=!1;projectedRectDepth=0;projectedRectArea=0;maxHalfWidth;activeLevelIndex=0;forceExact=!1;useLocalToClip=!1;constantClipW=!1;finiteLocalToClip=!1;localToClip=/* @__PURE__ */ new Float64Array(16);selectionProjectionBasis=/* @__PURE__ */ new Float64Array(4);localUnitsPerPixel=1;lastVisibleSegmentCount=0;allLevelBounds={minX:1/0,minY:1/0,maxX:-1/0,maxY:-1/0};fullViewBaselineLevelIndex=-1;fullViewMaxLevelIndex=-1;selectionGuard=null;stats;constructor(e,t){let n=t?void 0:$s.get(e);n&&(t=nc(e,n));let r=Xs();if(this.tileGrid=t?.tileGrid??ys(e.bounds,Math.max(0,e.segmentCount|0),e),this.tileSelectedLevelIndices=new Int16Array(this.tileGrid.columns*this.tileGrid.rows),this.tileSelectedLevelIndices.fill(-1),this.projectedTileUnitsPerPixel=new Float64Array(this.tileGrid.columns*this.tileGrid.rows),this.projectedTileWeights=new Float64Array(this.tileGrid.columns*this.tileGrid.rows),this.projectedTileVisibleFractions=new Float64Array(this.tileGrid.columns*this.tileGrid.rows),this.projectedTilePartial=new Uint8Array(this.tileGrid.columns*this.tileGrid.rows),this.maxHalfWidth=Math.max(0,e.maxHalfWidth),this.levels=t?.levels??us(fs(e,this.tileGrid)),t?.allLevelBounds)Object.assign(this.allLevelBounds,t.allLevelBounds);else for(let e of this.levels){let t=e.records;for(let n=0;n<e.segmentCount;n++){let r=t?t[n]:n;this.allLevelBounds.minX=Math.min(this.allLevelBounds.minX,e.segmentMinX[r]),this.allLevelBounds.minY=Math.min(this.allLevelBounds.minY,e.segmentMinY[r]),this.allLevelBounds.maxX=Math.max(this.allLevelBounds.maxX,e.segmentMaxX[r]),this.allLevelBounds.maxY=Math.max(this.allLevelBounds.maxY,e.segmentMaxY[r])}}this.levels.length>0&&(this.activeLevelIndex=0),this.stats=this.createEmptyStats();let i=t?.elapsedMs??Xs()-r;t?.elapsedMs!==0&&(Zs(i,e.segmentCount,this.levels),vs(i,e.segmentCount,this.levels.length)),tc.set(e,new WeakRef(this))}setScreenSpaceTransform(){this.useLocalToClip&&(this.selectionGuard=null,this.fullViewBaselineLevelIndex=-1),this.useLocalToClip=!1}setForceExact(e){this.forceExact!==e&&(this.forceExact=e,this.selectionGuard=null,this.fullViewBaselineLevelIndex=-1,this.tileSelectedLevelIndices.fill(-1))}setLocalToClipTransform(e,t){let n=!0,r=this.useLocalToClip&&this.constantClipW;for(let t=0;t<16;t+=1){let r=Number(e[t]);n&&=Number.isFinite(r),this.localToClip[t]=r||0}this.finiteLocalToClip=n;let i=this.localToClip,a=Math.max(Math.abs(this.tileGrid.minX),Math.abs(this.tileGrid.maxX),Math.abs(this.allLevelBounds.minX),Math.abs(this.allLevelBounds.maxX)),o=Math.max(Math.abs(this.tileGrid.minY),Math.abs(this.tileGrid.maxY),Math.abs(this.allLevelBounds.minY),Math.abs(this.allLevelBounds.maxY)),s=i[15],c=Math.abs(i[3])*a+Math.abs(i[7])*o;this.constantClipW=n&&Math.abs(s)>1e-8&&Number.isFinite(c)&&c<=Math.abs(s)*$o;for(let e=0;e<2&&r;e++){let t=i[e]/s,n=i[e+4]/s,a=this.selectionProjectionBasis[e],o=this.selectionProjectionBasis[e+2],c=Math.max(Math.abs(t),Math.abs(n),Math.abs(a),Math.abs(o))*$o;(Math.abs(t-a)>c||Math.abs(n-o)>c)&&(r=!1)}if(!this.constantClipW||!r){this.selectionGuard=null,this.fullViewBaselineLevelIndex=-1;for(let e=0;e<es.length;e++)this.selectionProjectionBasis[e]=i[es[e]]/s}this.useLocalToClip=!0,this.localUnitsPerPixel=Js(t)}updateForLocalUnitsPerPixel(e){return this.localUnitsPerPixel=Js(e),this.activeLevelIndex=this.chooseLevelIndex(this.localUnitsPerPixel),this.activeLevelIndex>0}update(e,t,n){return this.levels.length<=0?(this.lastVisibleSegmentCount=0,this.stats=this.createEmptyStats(),!0):this.updateTiledVisibleSegments(e,t,n)}getStats(){return{...this.stats,activeLevels:this.stats.activeLevels.map(e=>({...e}))}}resetVisible(){this.fullViewBaselineLevelIndex=-1,this.selectionGuard=null,this.lastVisibleSegmentCount=0;for(let e of this.levels)e.visibleSegmentCount=0;this.stats=this.createEmptyStats()}estimateVisibleSegmentCount(){return this.lastVisibleSegmentCount>0?this.lastVisibleSegmentCount:this.levels[this.activeLevelIndex]?.segmentCount??0}getRenderedSegmentCount(){return this.lastVisibleSegmentCount}chooseLevelIndex(e,t=1.25,n=!1){if(this.forceExact)return 0;let r=e*t;for(let e=this.levels.length-1;e>=1;--e)if((!n||this.levels[e].overview)&&this.levels[e].tolerance<=r)return e;return 0}updateTiledVisibleSegments(e,t,n){let r=ws(e,t,n,this.maxHalfWidth),i=this.chooseLevelIndex(this.localUnitsPerPixel),a=Math.max(i,this.chooseLevelIndex(this.localUnitsPerPixel,5,!0)),o=Os(r.minX,r.minY,r.maxX,r.maxY,this.tileGrid),s=!this.useLocalToClip||this.constantClipW&&n!=null&&[n.minX,n.minY,n.maxX,n.maxY].every(Number.isFinite)&&n.minX<=n.maxX&&n.minY<=n.maxY,c=s&&o!==null&&o.c0===0&&o.r0===0&&o.c1===this.tileGrid.columns-1&&o.r1===this.tileGrid.rows-1&&r.minX<=this.allLevelBounds.minX&&r.minY<=this.allLevelBounds.minY&&r.maxX>=this.allLevelBounds.maxX&&r.maxY>=this.allLevelBounds.maxY;if(c&&this.fullViewBaselineLevelIndex===i&&this.fullViewMaxLevelIndex===a)return!1;let l=s&&this.levels[0].segmentCount>=15e4&&[r.minX,r.minY,r.maxX,r.maxY].every(Number.isFinite)?256*this.localUnitsPerPixel:0,u=this.selectionGuard;if(l>0&&u&&o&&u.baseline===i&&u.maxLevel===a&&o.c0>=u.range.c0&&o.c1<=u.range.c1&&o.r0>=u.range.r0&&o.r1<=u.range.r1&&r.minX>=u.bounds.minX&&r.minY>=u.bounds.minY&&r.maxX<=u.bounds.maxX&&r.maxY<=u.bounds.maxY&&u.bounds.maxX-u.bounds.minX<=r.maxX-r.minX+l*4&&u.bounds.maxY-u.bounds.minY<=r.maxY-r.minY+l*4)return!1;if(this.selectionGuard=null,this.fullViewBaselineLevelIndex=-1,this.resetLevelDrawLists(),!o)return this.lastVisibleSegmentCount=0,this.updateLevelStats(0,0,0,0,i,0,i,i),!0;let d=l>0?{minX:r.minX-l,minY:r.minY-l,maxX:r.maxX+l,maxY:r.maxY+l}:null,f=d&&[d.minX,d.minY,d.maxX,d.maxY].every(Number.isFinite)?d:r,p=this.useLocalToClip&&!this.constantClipW?this.projectTiles(o,t):-1,m=p>=0,h=!m&&f!==r?Os(f.minX,f.minY,f.maxX,f.maxY,this.tileGrid)??o:o,g=0,_=0;for(let e=o.r0;e<=o.r1;e++)for(let t=o.c0;t<=o.c1;t++){let n=e*this.tileGrid.columns+t;m&&this.projectedTileUnitsPerPixel[n]<0||(g++,this.levels[0].tileCounts[n]>0&&_++)}let v=Math.max(1,Math.ceil(Uo/Math.max(1,_))),y=m?this.levels.length:i,b=0,x=0,S=0,C=i,w=0,T=i,E=!this.forceExact&&this.levels.some(e=>e.overview),D=Uo*rs;for(let e=0;e<2;e++){e>0&&(this.resetLevelDrawLists(),y=m?this.levels.length:i,b=0,x=0,w=0);let t=0;selectTiles:for(let n=h.r0;n<=h.r1;n+=1)for(let r=h.c0;r<=h.c1;r+=1){let s=n*this.tileGrid.columns+r,c=n>=o.r0&&n<=o.r1&&r>=o.c0&&r<=o.c1,l=this.levels[0].tileCounts[s],u=i,d=a,h=v,g=null;if(m){let e=this.projectedTileUnitsPerPixel[s];if(e<0||l===0)continue;for(u=this.chooseLevelIndex(e),d=Math.max(u,this.chooseLevelIndex(e,5,!0));d>0&&!this.tileReachWithinBudget(s,d);)d--;u=Math.min(u,d),p>0&&(h=Math.max(1,Math.round(Uo*this.projectedTileWeights[s]/p))),b+=h,this.projectedTilePartial[s]&&(g=this.projectedPlanes),y=Math.min(y,u)}let _=this.chooseTileLevel(s,h,u,d,e>0),O=this.levels[_].tileCounts[s];if(!c){Ts(this.levels[_],s,f,g);continue}l>x&&(x=l,S=O,C=_),O>w&&(w=O,T=_);let k=this.levels[_],A=k.visibleSegmentCount;if(Ts(k,s,f,g,E&&e===0?82501-t:1/0),t+=k.visibleSegmentCount-A,E&&e===0&&t>D)break selectTiles}if(!E||t<=D)break}return m&&(y>=this.levels.length&&(y=i),_>0&&(v=Math.round(b/_))),this.activeLevelIndex=y,this.updateLevelStats(g,v,x,S,C,w,T,y),c&&(this.fullViewBaselineLevelIndex=i,this.fullViewMaxLevelIndex=a),f!==r&&(this.selectionGuard={bounds:f,range:h,baseline:i,maxLevel:a}),!0}resetLevelDrawLists(){for(let e of this.levels)e.visibleSegmentCount=0,e.markToken+=1,e.markToken>=2**(8*e.segmentMarks.BYTES_PER_ELEMENT)-1&&(e.segmentMarks.fill(0),e.markToken=1)}chooseTileLevel(e,t,n,r,i=!1){if(this.forceExact||this.levels[0].tileCounts[e]<=t)return this.tileSelectedLevelIndices[e]=0,0;for(let r=1;r<=n;r++)if(!this.levels[r].overview&&this.levels[r].tileCounts[e]<=t)return this.tileSelectedLevelIndices[e]=r,r;let a=this.chooseTargetBalancedTileLevel(e,t,r),o=Math.max(1,t*rs);if(i&&this.levels[a].tileCounts[e]>o)for(let t=r+1;t<this.levels.length;t++){if(!this.levels[t].overview)continue;let n=this.levels[t].tileCounts[e];if(n<this.levels[a].tileCounts[e]&&(a=t),n<=o)break}let s=this.tileSelectedLevelIndices[e];if(s>=0&&s<=r){let n=this.levels[s].tileCounts[e];if(n<=o){let r=this.levels[a].tileCounts[e];if(Ms(n,t)<=Ms(r,t)+Math.max(2,t*.18))return s}}return this.tileSelectedLevelIndices[e]=a,a}chooseTargetBalancedTileLevel(e,t,n){let r=Math.max(1,t*rs),i=-1,a=1/0,o=1/0,s=n;for(let c=0;c<=n;c+=1){let n=this.levels[c].tileCounts[e];if((n<o||n===o&&c<s)&&(o=n,s=c),n>r)continue;let l=Ms(n,t);(l<a||l===a&&(i<0||c<i))&&(a=l,i=c)}return i>=0?i:s}projectTiles(e,t){if(!this.finiteLocalToClip)return-1;let n=this.localToClip;this.projectedHalfWidth=Math.max(1,t.width)*.5,this.projectedHalfHeight=Math.max(1,t.height)*.5;let r=this.projectedPlanes;for(let e=0;e<2;e++){let t=1+16/(e===0?this.projectedHalfWidth:this.projectedHalfHeight);for(let i=0;i<2;i++){let a=i===0?1:-1,o=(e*2+i)*3;r[o]=n[3]*t+a*n[e],r[o+1]=n[7]*t+a*n[4+e],r[o+2]=n[15]*t+a*n[12+e]}}let i=this.tileGrid,a=this.projectedTileRect,o=1/0;for(let t=e.r0;t<=e.r1;t++)for(let n=e.c0;n<=e.c1;n++){let e=t*i.columns+n;this.readProjectedTileRect(e);let r=this.projectRect(a[0],a[1],a[2],a[3]);this.projectedTileUnitsPerPixel[e]=r,!(r<0)&&(o=Math.min(o,this.projectedRectDepth),this.projectedTileWeights[e]=this.projectedRectDepth,this.projectedTilePartial[e]=+!!this.projectedClipCut,this.projectedTileVisibleFractions[e]=Math.min(1,this.projectedRectArea/Math.max(1e-300,(a[2]-a[0])*(a[3]-a[1]))))}let s=0;for(let t=e.r0;t<=e.r1;t++)for(let n=e.c0;n<=e.c1;n++){let e=t*i.columns+n;if(this.projectedTileUnitsPerPixel[e]<0)continue;let r=this.projectedTileWeights[e],a=o>0?o/r:r>0?0:1,c=a*a*a;this.projectedTileWeights[e]=c,this.levels[0].tileCounts[e]>0&&(s+=c*this.projectedTileVisibleFractions[e])}return s}readProjectedTileRect(e){let t=this.tileGrid,n=e%t.columns,r=(e-n)/t.columns,i=this.projectedTileRect,a=(t.xEdges[n+1]-t.xEdges[n])*is,o=(t.yEdges[r+1]-t.yEdges[r])*is;i[0]=(n===0?Math.min(t.xEdges[0],this.allLevelBounds.minX):t.xEdges[n])-a,i[1]=(r===0?Math.min(t.yEdges[0],this.allLevelBounds.minY):t.yEdges[r])-o,i[2]=(n===t.columns-1?Math.max(t.xEdges[n+1],this.allLevelBounds.maxX):t.xEdges[n+1])+a,i[3]=(r===t.rows-1?Math.max(t.yEdges[r+1],this.allLevelBounds.maxY):t.yEdges[r+1])+o}projectRect(e,t,n,r){let i=this.clipRectToFrustum(e,t,n,r);if(i<3)return-1;let a=this.localToClip,o=this.projectedClip,s=this.projectedHalfWidth,c=this.projectedHalfHeight,l=1/0,u=0,d=0,f=0;for(let e=0;e<i;e++){let t=o[e*2],n=o[e*2+1],r=a[0]*t+a[4]*n+a[12],p=a[1]*t+a[5]*n+a[13],m=a[3]*t+a[7]*n+a[15],h=(a[0]*m-r*a[3])*s,g=(a[4]*m-r*a[7])*s,_=(a[1]*m-p*a[3])*c,v=(a[5]*m-p*a[7])*c,y=h*h+g*g+_*_+v*v,b=h*v-g*_;u=Math.max(u,Math.sqrt(.5*(y+Math.sqrt(Math.max(0,y*y-4*b*b))))),l=Math.min(l,m),d+=m;let x=e+1<i?e+1:0;f+=t*o[x*2+1]-o[x*2]*n}return this.projectedRectDepth=Math.max(0,d/i),this.projectedRectArea=Math.abs(f)*.5,l>0?u>0?l*l/u:1/0:0}tileReachWithinBudget(e,t){let n=this.getLevelTileReach(t),r=e*4,i=n[r],a=n[r+1],o=n[r+2],s=n[r+3];if(!(i<=o&&a<=s))return!0;this.readProjectedTileRect(e);let c=this.projectedTileRect;if(i>=c[0]&&a>=c[1]&&o<=c[2]&&s<=c[3])return!0;let l=this.projectRect(i,a,o,s);return l<0||this.levels[t].tolerance<=l*5}getLevelTileReach(e){let t=this.levelTileReach[e];if(t)return t;let n=this.levels[e],r=this.tileGrid.columns*this.tileGrid.rows;t=new Float32Array(r*4);let i=n.records;for(let e=0;e<r;e++){let r=1/0,a=1/0,o=-1/0,s=-1/0,c=n.tileOffsets[e],l=c+n.tileCounts[e];for(let e=c;e<l;e++){let t=i?i[n.tileSegmentIds[e]]:n.tileSegmentIds[e];r=Math.min(r,n.segmentMinX[t]),a=Math.min(a,n.segmentMinY[t]),o=Math.max(o,n.segmentMaxX[t]),s=Math.max(s,n.segmentMaxY[t])}t[e*4]=r,t[e*4+1]=a,t[e*4+2]=o,t[e*4+3]=s}return this.levelTileReach[e]=t,t}clipRectToFrustum(e,t,n,r){let i=this.projectedClip,a=this.projectedPlanes;i[0]=e,i[1]=t,i[2]=n,i[3]=t,i[4]=n,i[5]=r,i[6]=e,i[7]=r;let o=4,s=0,c=!1;for(let e=0;e<a.length&&o>0;e+=3){let t=a[e],n=a[e+1],r=a[e+2],l=16-s,u=0,d=i[s+o*2-2],f=i[s+o*2-1],p=t*d+n*f+r;for(let e=0;e<o;e++){let a=i[s+e*2],o=i[s+e*2+1],m=t*a+n*o+r;if(m>=0!=p>=0&&u<8){let e=p/(p-m);i[l+u*2]=d+(a-d)*e,i[l+u*2+1]=f+(o-f)*e,u++}m<0?c=!0:u<8&&(i[l+u*2]=a,i[l+u*2+1]=o,u++),d=a,f=o,p=m}o=u,s=l}return this.projectedClipCut=c,o}updateLevelStats(e,t,n,r,i,a,o,s){let c=0,l=[];for(let e=0;e<this.levels.length;e+=1){let t=this.levels[e],n=t.visibleSegmentCount;c+=n,n>0&&l.push({index:e,overview:t.overview,tolerance:t.tolerance,renderedSegments:n})}this.lastVisibleSegmentCount=c,this.stats={renderedSegments:c,visibleTileCount:e,targetSegmentsPerTile:t,baselineLevelIndex:s,baselineTolerance:this.levels[s]?.tolerance??0,activeLevels:l,maxBaselineTileSegments:n,maxBaselineTileSelectedSegments:r,maxBaselineTileSelectedLevelIndex:i,maxBaselineTileSelectedTolerance:this.levels[i]?.tolerance??0,maxSelectedTileSegments:a,maxSelectedTileLevelIndex:o,maxSelectedTileTolerance:this.levels[o]?.tolerance??0,tileGridColumns:this.tileGrid.columns,tileGridRows:this.tileGrid.rows,totalLevels:this.levels.length}}createEmptyStats(){return{renderedSegments:0,visibleTileCount:0,targetSegmentsPerTile:0,baselineLevelIndex:this.activeLevelIndex,baselineTolerance:this.levels[this.activeLevelIndex]?.tolerance??0,activeLevels:[],maxBaselineTileSegments:0,maxBaselineTileSelectedSegments:0,maxBaselineTileSelectedLevelIndex:this.activeLevelIndex,maxBaselineTileSelectedTolerance:this.levels[this.activeLevelIndex]?.tolerance??0,maxSelectedTileSegments:0,maxSelectedTileLevelIndex:this.activeLevelIndex,maxSelectedTileTolerance:this.levels[this.activeLevelIndex]?.tolerance??0,tileGridColumns:this.tileGrid.columns,tileGridRows:this.tileGrid.rows,totalLevels:this.levels.length}}};function cs(e,t,n){return e===`off`||t!==`webgl`&&t!==`webgpu`?!1:e===`force`?n>0:n>=15e4}function ls(e,t){let n=e.segmentCount>5e4&&(t??it(e));return[...n?[{tolerance:Ho[0],overview:!1}]:[],...Ho.map(e=>({tolerance:e,overview:n}))]}function us(e){for(;;){let t=e.next();if(t.done)return t.value}}function*ds(e,t=it(e)){let n=Math.max(0,e.segmentCount|0),r=new Xo(e),i=[{tolerance:0,segmentCount:n,sceneBounds:e.bounds,maxHalfWidth:e.maxHalfWidth}],a=n,o=ls(e,t),s=o.length;try{for(let n=0;n<s;n+=1){let{tolerance:c,overview:l}=o[n],u=.06+n/s*.62,d=.06+(n+1)/s*.62;yield{value:u,message:`Simplifying Vector LOD ${n+1}/${s}`,yieldable:!1};let f=yield*_s(e,c,l,r,u,d,t),p=f!==null&&f.segmentCount>0&&f.segmentCount<a*.985,m=r.endLevel(p);f&&m&&(i.push({tolerance:c,overview:l,segmentCount:f.segmentCount,records:m,sceneBounds:f.bounds,maxHalfWidth:f.maxHalfWidth}),a=f.segmentCount)}}finally{dt(e)}return{store:{canonical:e,literals:r.finish()},levels:i}}function*fs(e,t,n){let r=yield*ds(e,n),i=yield*ms(r.store,.68,.72),a=[],o=Math.max(1,r.levels.length);for(let e=0;e<r.levels.length;e+=1){let n=r.levels[e],s=.72+e/o*.26,c=.72+(e+1)/o*.26;yield{value:s,message:`Building Vector LOD buckets ${e+1}/${r.levels.length}`,yieldable:!1};let l=yield*hs(n.records,n.segmentCount,i,t,s,c);a.push(new ps(r.store,n,l,i))}return a}var ps=class{overview;tolerance;segmentCount;records;store;sceneBounds;maxHalfWidth;tileOffsets;tileCounts;tileSegmentIds;segmentMarks;segmentMinX;segmentMinY;segmentMaxX;segmentMaxY;visibleSegmentIds;visibleSegmentCount=0;markToken=1;constructor(e,t,n,r){this.overview=t.overview,this.tolerance=t.tolerance,this.segmentCount=t.segmentCount,this.records=t.records,this.store=e,this.sceneBounds=t.sceneBounds,this.maxHalfWidth=t.maxHalfWidth,this.tileOffsets=n.tileOffsets,this.tileCounts=n.tileCounts,this.tileSegmentIds=n.tileSegmentIds,this.segmentMarks=new Uint8Array(t.segmentCount),this.segmentMinX=r.minX,this.segmentMinY=r.minY,this.segmentMaxX=r.maxX,this.segmentMaxY=r.maxY,this.visibleSegmentIds=new Uint32Array(Math.max(1,Math.min(4096,t.segmentCount)))}get scene(){return Ri(this)}};function*ms(e,t,n){let r=Math.max(0,e.canonical.segmentCount|0),i=r+Math.max(0,e.literals.segmentCount|0),a=new Float32Array(i),o=new Float32Array(i),s=new Float32Array(i),c=new Float32Array(i),l={minX:0,minY:0,maxX:0,maxY:0};for(let u=0;u<i;u+=1){u<r?Ds(e.canonical,u,l):Ds(e.literals,u-r,l);let d=.35;a[u]=l.minX-d,o[u]=l.minY-d,s[u]=l.maxX+d,c[u]=l.maxY+d,u&8191||(yield{value:t+(n-t)*(u/Math.max(1,i)),message:`Preparing Vector LOD bounds`,yieldable:!0})}return{minX:a,minY:o,maxX:s,maxY:c}}function*hs(e,t,n,r,i,a,o=1/0){let s=0,c=r.columns*r.rows,l=new Uint32Array(c),u={c0:0,c1:0,r0:0,r1:0};for(let c=0;c<t;c+=1){let d=e?e[c]:c;if(ks(n.minX[d],n.minY[d],n.maxX[d],n.maxY[d],r,u)){if(s+=(u.r1-u.r0+1)*(u.c1-u.c0+1),s>o)throw Error(`Vector LOD tile index resource limit exceeded`);for(let e=u.r0;e<=u.r1;e+=1){let t=e*r.columns+u.c0;for(let e=u.c0;e<=u.c1;e+=1)l[t]+=1,t+=1}}c&4095||(yield{value:i+(a-i)*.5*c/Math.max(1,t),message:`Counting Vector LOD tiles`,yieldable:!0})}let d=new Uint32Array(c+1);for(let e=0;e<c;e+=1)d[e+1]=d[e]+l[e];let f=new Uint32Array(d[c]),p=d.slice(0,c);for(let o=0;o<t;o+=1){let s=e?e[o]:o;if(ks(n.minX[s],n.minY[s],n.maxX[s],n.maxY[s],r,u))for(let e=u.r0;e<=u.r1;e+=1){let t=e*r.columns+u.c0;for(let e=u.c0;e<=u.c1;e+=1){let e=p[t];f[e]=o,p[t]=e+1,t+=1}}o&4095||(yield{value:i+(a-i)*(.5+.5*o/Math.max(1,t)),message:`Assigning Vector LOD tiles`,yieldable:!0})}return{tileOffsets:d,tileCounts:l,tileSegmentIds:f}}function gs(e){let t=Ko.get(e)??null;return Ko.delete(e),t}function*_s(e,t,n,r,i,a,o){r.beginLevel();let s=Math.max(0,e.segmentCount|0);if(s<=0||t<=0)return null;let c=Ys(t),l=`Simplifying ${c}`,u=`Aggregating ${c}`,d=`Merging ${c}`,f=(e,t)=>({value:i+(a-i)*e,message:t,yieldable:!0}),p=Ws(e.bounds,t),m=n?void 0:ft(e,!1),h=new Ro(t,n,t=>{let n=K(e,t);return n&&m&&(n.paintGroup=m[t]),n}),g=!n&&o?new Wo:null,_=Ks(),v=0,y=NaN,b=NaN,x=NaN,S=Ns(e),C,w=0;for(let i=0;i<s;i+=1){i&4095||(yield f(i/Math.max(1,s)*.72,l));let a=K(e,i);if(!a||a.alpha<=.001)continue;let o=S&&a.paintGroup!==C;if(o||(g||n)&&!e.drawRuns&&(a.colorR!==y||a.colorG!==b||a.colorB!==x)){let c=0;for(let n of g?.values()??[])Ls(e,n,r,_,t*os),++c&1023||(yield f(.72*i/Math.max(1,s),u));if(n||o){for(let e of h.values())Bs(e,r,_,t),++c&1023||(yield f(.72*i/Math.max(1,s),d));h.clear()}o&&(w+=g?.size??0),g?.clear(),C=a.paintGroup,y=a.colorR,b=a.colorG,x=a.colorB}if(n&&Rs(a,t))continue;if(g&&Ps(g,a,i,t,w)){v=Math.max(v,a.halfWidth);continue}if(a.primitiveType>=.5||!n&&zs(a,t)){q(r,_,a,i),v=Math.max(v,a.halfWidth);continue}let c=a.x1-a.x0,T=a.y1-a.y0;if(c===0&&T===0){a.flags&2&&(q(r,_,a,i),v=Math.max(v,a.halfWidth));continue}let E=Gs(Hs(a),Us(a),e.bounds,p);h.add(m?{...a,paintGroup:m[i]}:a,i,E),v=Math.max(v,a.halfWidth)}let T=0;for(let n of g?.values()??[])Ls(e,n,r,_,t*os),++T&1023||(yield f(.72,u));let E=0,D=Math.max(1,h.size);for(let e of h.values())Bs(e,r,_,t),E+=1,E&1023||(yield f(.72+.28*E/D,d));h.clear(),g?.clear();let O=r.levelRecordCount;return O===0?null:{segmentCount:O,bounds:qs(_,e.bounds),maxHalfWidth:v}}function vs(e,t,n){Go.elapsedMs+=Math.max(0,e),Go.buildCount+=1,Go.sourceSegmentCount+=Math.max(0,t|0),Go.levelCount+=Math.max(0,n|0)}function ys(e,t,n){let r=Math.max(1e-6,e.maxX-e.minX),i=Math.max(1e-6,e.maxY-e.minY),a=Y(Math.round(Math.max(1,t)/512),256,4096),o=r/i,s=Math.round(Math.sqrt(a*o)),c=Math.round(a/Math.max(1,s));s=Y(s,12,96),c=Y(c,12,96);let l=bs(e.minX,e.maxX,s,n,`x`),u=bs(e.minY,e.maxY,c,n,`y`);return{columns:s,rows:c,minX:e.minX,minY:e.minY,maxX:e.maxX,maxY:e.maxY,tileWidth:r/s,tileHeight:i/c,xEdges:l,yEdges:u}}function bs(e,t,n,r,i){if(!r||n<=1||r.segmentCount<=n*4)return Cs(e,t,n);let a=Math.max(1e-9,t-e),o=Math.max(0,r.segmentCount|0),s=Y(n*16,256,4096),c=new Float64Array(s),l=/* @__PURE__ */ new Map,u={minX:0,minY:0,maxX:0,maxY:0},d=0;for(let t=0;t<o;t+=1){Ds(r,t,u);let n=i===`x`?u.minX:u.minY,o=i===`x`?u.maxX:u.maxY,f=(n+o)*.5;if(!Number.isFinite(f))continue;let p=(f-e)/a,m=Y(Math.floor(p*s),0,s-1),h=Y(Math.floor((Math.min(n,o)-e)/a*s),0,s-1),g=Y(Math.floor((Math.max(n,o)-e)/a*s),0,s-1),_=Ss(r,t);c[m]+=.45,xs(l,_,m,1),h!==m&&(c[h]+=ts,xs(l,_,h,ts)),g!==m&&g!==h&&(c[g]+=ts,xs(l,_,g,ts)),d+=1}if(d<=n)return Cs(e,t,n);for(let[e,t]of l){let n=e%ns;c[n]+=Math.sqrt(Math.max(0,t))*3.2}let f=Math.max(1e-6,d/s*.015),p=0;for(let e=0;e<s;e+=1)c[e]+=f,p+=c[e];let m=new Float64Array(n+1);m[0]=e,m[n]=t;let h=a/n*.22,g=0,_=0;for(let r=1;r<n;r+=1){let i=p*r/n;for(;g<s-1&&_+c[g]<i;)_+=c[g],g+=1;let o=Math.max(1e-9,c[g]),l=Qs((i-_)/o,0,1),u=e+(g+l)/s*a,d=m[r-1]+h,f=t-(n-r)*h;m[r]=Qs(u,d,f)}return m}function xs(e,t,n,r){let i=t*ns+n;e.set(i,(e.get(i)??0)+r)}function Ss(e,t){let n=t*4,r=Math.max(0,e.styles[n]??0),i=e.primitiveMeta[n+3]??0,a=Math.max(0,Math.floor(i/2+1e-6)),o=J(i-a*2),s=Y(Math.round(Math.log1p(r)*32),0,255),c=a&3,l=Y(Math.round(o*15),0,15),u=Y(Math.round(J(e.styles[n+1]??0)*31),0,31),d=Y(Math.round(J(e.styles[n+2]??0)*31),0,31),f=Y(Math.round(J(e.styles[n+3]??0)*31),0,31);return((((s*4+c)*16+l)*32+u)*32+d)*32+f}function Cs(e,t,n){let r=new Float64Array(n+1),i=t-e;for(let t=0;t<=n;t+=1)r[t]=e+i*t/n;return r[0]=e,r[n]=t,r}function ws(e,t,n,r){let i=Math.max(1e-6,e.zoom),a=Math.max(1,t.width)/(2*i),o=Math.max(1,t.height)/(2*i),s=Math.max(16/i,r*2,.5);return n?{minX:n.minX-s,minY:n.minY-s,maxX:n.maxX+s,maxY:n.maxY+s}:{minX:e.cameraCenterX-a-s,minY:e.cameraCenterY-o-s,maxX:e.cameraCenterX+a+s,maxY:e.cameraCenterY+o+s}}function Ts(e,t,n,r=null,i=1/0){let a=e.tileOffsets[t],o=a+e.tileCounts[t],s=e.records,c=e.visibleSegmentCount,l=c+i;for(let t=a;t<o&&c<l;t+=1){let i=e.tileSegmentIds[t];if(e.segmentMarks[i]===e.markToken)continue;let a=s?s[i]:i,o=e.segmentMinX[a],l=e.segmentMinY[a],u=e.segmentMaxX[a],d=e.segmentMaxY[a];if(!(u<n.minX||o>n.maxX||d<n.minY||l>n.maxY)&&(!r||Es(r,o,l,u,d))){if(e.segmentMarks[i]=e.markToken,c===e.visibleSegmentIds.length){let t=new Uint32Array(Math.min(e.segmentMarks.length,Math.max(1,c*2)));t.set(e.visibleSegmentIds),e.visibleSegmentIds=t}e.visibleSegmentIds[c]=i,c+=1}}e.visibleSegmentCount=c}function Es(e,t,n,r,i){for(let a=0;a<e.length;a+=3){let o=e[a],s=e[a+1];if(o*(o>=0?r:t)+s*(s>=0?i:n)+e[a+2]<0)return!1}return!0}function Ds(e,t,n){let r=t*4,i=Math.max(0,e.styles[r]??0);if(!(Math.floor(e.primitiveMeta[r+3]/2+1e-6)&4)){n.minX=e.primitiveBounds[r]-i,n.minY=e.primitiveBounds[r+1]-i,n.maxX=e.primitiveBounds[r+2]+i,n.maxY=e.primitiveBounds[r+3]+i;return}n.minX=Math.max(e.primitiveBounds[r],Math.min(e.endpoints[r],e.endpoints[r+2],e.primitiveMeta[r])-i),n.minY=Math.max(e.primitiveBounds[r+1],Math.min(e.endpoints[r+1],e.endpoints[r+3],e.primitiveMeta[r+1])-i),n.maxX=Math.min(e.primitiveBounds[r+2],Math.max(e.endpoints[r],e.endpoints[r+2],e.primitiveMeta[r])+i),n.maxY=Math.min(e.primitiveBounds[r+3],Math.max(e.endpoints[r+1],e.endpoints[r+3],e.primitiveMeta[r+1])+i),(n.minX>n.maxX||n.minY>n.maxY)&&(n.minX=n.minY=1/0,n.maxX=n.maxY=-1/0)}function Os(e,t,n,r,i){let a={c0:0,c1:0,r0:0,r1:0};return ks(e,t,n,r,i,a)?a:null}function ks(e,t,n,r,i,a){return n<i.minX||e>i.maxX||r<i.minY||t>i.maxY?!1:(a.c0=As(i.xEdges,e),a.c1=js(i.xEdges,n),a.r0=As(i.yEdges,t),a.r1=js(i.yEdges,r),!0)}function As(e,t){let n=e.length-2;if(t<=e[0])return 0;if(t>=e[e.length-1])return n;let r=0,i=e.length-1;for(;r+1<i;){let n=r+i>>1;e[n]<=t?r=n:i=n}return Y(r,0,n)}function js(e,t){return As(e,t)}function Ms(e,t){let n=e-t;return n>=0?n:-n*1.15}function Ns(e){let t=ft(e);if(!t)return!1;for(let e=1;e<t.length;e++)if(t[e]<t[e-1])return!1;return!0}function K(e,t){let n=t*4,r=e.endpoints[n],i=e.endpoints[n+1],a=e.endpoints[n+2],o=e.endpoints[n+3],s=e.primitiveMeta[n],c=e.primitiveMeta[n+1],l=e.primitiveMeta[n+2],u=e.primitiveMeta[n+3],d=Math.max(0,Math.trunc(u/2+1e-6)),f=J(u-d*2);if(!Number.isFinite(r)||!Number.isFinite(i)||!Number.isFinite(s)||!Number.isFinite(c))return null;let p;if(d&4){let t=e.primitiveBounds[n],r=e.primitiveBounds[n+1],i=e.primitiveBounds[n+2],a=e.primitiveBounds[n+3];Number.isFinite(t)&&Number.isFinite(r)&&Number.isFinite(i)&&Number.isFinite(a)&&(p={minX:t,minY:r,maxX:i,maxY:a})}return{paintOrder:ut(e,t),paintGroup:ft(e)?.[t],x0:r,y0:i,cx:a,cy:o,x1:s,y1:c,primitiveType:l,halfWidth:Math.max(0,e.styles[n]??0),flags:d,alpha:f,colorR:J(e.styles[n+1]??0),colorG:J(e.styles[n+2]??0),colorB:J(e.styles[n+3]??0),visibleBounds:p}}function Ps(e,t,n,r,i=0){let a=t.x0===t.x1&&t.y0===t.y1;if(t.primitiveType!==0||t.alpha!==1||!(t.halfWidth>0)||t.flags&1||a&&!(t.flags&2))return!1;let o=r*os,s=Math.floor(t.x0/o),c=Math.floor(t.y0/o);if(Math.floor(t.x1/o)!==s||Math.floor(t.y1/o)!==c)return!1;let l=t.x1<t.x0||t.x1===t.x0&&t.y1<t.y0,u=a?0:Math.round(Math.atan2(l?t.y0-t.y1:t.y1-t.y0,Math.abs(t.x1-t.x0))/Qo),d=t.visibleBounds,f=e.key;f[0]=t.paintGroup??-1,f[1]=s,f[2]=c,f[3]=+!!a,f[4]=u,f[5]=t.flags,f[6]=t.halfWidth,f[7]=t.colorR,f[8]=t.colorG,f[9]=t.colorB,f[10]=+!!d,f[11]=d?d.minX:0,f[12]=d?d.minY:0,f[13]=d?d.maxX:0,f[14]=d?d.maxY:0;let p=e.find();if(!p){if(i+e.size>=25e4)return!1;p=Fs(),e.add(p)}return Is(p,t,n),!0}function Fs(){return{members:[],count:0,coincident:!0,x0:0,y0:0,x1:0,y1:0}}function Is(e,t,n){let r=t.x0,i=t.y0,a=t.x1,o=t.y1;(a<r||a===r&&o<i)&&([r,a]=[a,r],[i,o]=[o,i]),e.count>0&&(r!==e.x0/e.count||i!==e.y0/e.count||a!==e.x1/e.count||o!==e.y1/e.count)&&(e.coincident=!1),e.members.push(n),e.count++,e.x0+=r,e.y0+=i,e.x1+=a,e.y1+=o}function Ls(e,t,n,r,i,a=0){if(t.coincident?t.count<2:t.count<8||a>=8){for(let i of t.members)q(n,r,K(e,i),i);return}if(!t.coincident&&t.count>8){let o=/* @__PURE__ */ new Map,s=i*.5;for(let i of t.members){let t=K(e,i),a=Math.floor(t.x0/s),c=Math.floor(t.y0/s);if(Math.floor(t.x1/s)!==a||Math.floor(t.y1/s)!==c){q(n,r,t,i);continue}let l=`${a},${c}`,u=o.get(l);u||o.set(l,u=Fs()),Is(u,t,i)}for(let t of o.values())Ls(e,t,n,r,s,a+1);return}let o=K(e,t.members[0]);o.x0=t.x0/t.count,o.y0=t.y0/t.count,o.x1=o.cx=t.x1/t.count,o.y1=o.cy=t.y1/t.count;let s=K(e,t.members[0]);if((s.x0!==s.x1||s.y0!==s.y1)&&Math.fround(o.x0)===Math.fround(o.x1)&&Math.fround(o.y0)===Math.fround(o.y1)){for(let i of t.members)q(n,r,K(e,i),i);return}for(let e=t.count;e>0;){let t=Math.min(e,65535);o.primitiveType=1-t,q(n,r,o,-1),e-=t}}function Rs(e,t){let n=e.primitiveType>=.5,r=n?e.cx:e.x1,i=n?e.cy:e.y1;return Math.max(Math.max(e.x0,r,e.x1)-Math.min(e.x0,r,e.x1),Math.max(e.y0,i,e.y1)-Math.min(e.y0,i,e.y1))+e.halfWidth*2<=t*as}function zs(e,t){let n=Math.max(Math.max(e.x0,e.cx,e.x1)-Math.min(e.x0,e.cx,e.x1),Math.max(e.y0,e.cy,e.y1)-Math.min(e.y0,e.cy,e.y1));return n<=t*as&&(n>0||!!(e.flags&2))}function Bs(e,t,n,r){let i=e.intervals.length>>1;if(i<=0)return;e.offsetWeightSum>0&&(e.offset=e.offsetSum/e.offsetWeightSum);let a=e.intervals,o=new Uint32Array(i);for(let e=0;e<i;e+=1)o[e]=e*2;o.sort((e,t)=>a[e]-a[t]||a[e+1]-a[t+1]);let s=r*1.5,c=a[o[0]],l=a[o[0]+1];for(let r=1;r<o.length;r+=1){let i=a[o[r]],u=a[o[r]+1];if(i<=l+s){l=Math.max(l,u);continue}Vs(e,t,n,c,l),c=i,l=u}Vs(e,t,n,c,l)}function Vs(e,t,n,r,i){if(i<=r)return;let a=!!(e.flags&4)&&e.clipMinX<=e.clipMaxX&&e.clipMinY<=e.clipMaxY;q(t,n,{paintOrder:e.paintOrder,paintGroup:e.paintGroup,x0:e.axisX*r+e.normalX*e.offset,y0:e.axisY*r+e.normalY*e.offset,cx:e.axisX*i+e.normalX*e.offset,cy:e.axisY*i+e.normalY*e.offset,x1:e.axisX*i+e.normalX*e.offset,y1:e.axisY*i+e.normalY*e.offset,primitiveType:0,halfWidth:e.halfWidth,flags:e.flags,alpha:e.alpha,colorR:e.colorR,colorG:e.colorG,colorB:e.colorB,visibleBounds:a?{minX:e.clipMinX,minY:e.clipMinY,maxX:e.clipMaxX,maxY:e.clipMaxY}:void 0},-1)}function q(e,t,n,r){let i=n.visibleBounds,a=i?i.minX:Math.min(n.x0,n.cx,n.x1),o=i?i.minY:Math.min(n.y0,n.cy,n.y1),s=i?i.maxX:Math.max(n.x0,n.cx,n.x1),c=i?i.maxY:Math.max(n.y0,n.cy,n.y1);e.push(n,a,o,s,c,r),t.minX=Math.min(t.minX,a),t.minY=Math.min(t.minY,o),t.maxX=Math.max(t.maxX,s),t.maxY=Math.max(t.maxY,c)}function Hs(e){let t=e.visibleBounds;return t?(t.minX+t.maxX)*.5:(e.x0+e.x1)*.5}function Us(e){let t=e.visibleBounds;return t?(t.minY+t.maxY)*.5:(e.y0+e.y1)*.5}function Ws(e,t){let n=Math.max(1e-6,e.maxX-e.minX),r=Math.max(1e-6,e.maxY-e.minY),i=Math.max(n,r),a=Math.max(96,t*192),o=Y(Math.ceil(i/a),16,96),s=n/r,c=s>=1?o:Math.max(1,Math.ceil(o*s)),l=s>=1?Math.max(1,Math.ceil(o/s)):o;return{columns:c,rows:l,tileWidth:n/c,tileHeight:r/l}}function Gs(e,t,n,r){let i=Y(Math.floor((e-n.minX)/r.tileWidth),0,r.columns-1);return Y(Math.floor((t-n.minY)/r.tileHeight),0,r.rows-1)*r.columns+i}function Ks(){return{minX:1/0,minY:1/0,maxX:-1/0,maxY:-1/0}}function qs(e,t){return Number.isFinite(e.minX)&&Number.isFinite(e.minY)&&Number.isFinite(e.maxX)&&Number.isFinite(e.maxY)?e:t}function Js(e){return Number.isFinite(e)&&e>1e-8?e:1}function Ys(e){return e<=0?`exact`:`tol-${String(e).replace(`.`,`_`)}`}function Xs(){return typeof performance<`u`&&typeof performance.now==`function`?performance.now():Date.now()}function Zs(e,t,n){let r=n.map(e=>`${Ys(e.tolerance)}:${e.segmentCount}`).join(`, `);console.info(`[hepr] vector stroke LOD generated in ${e.toFixed(1)}ms (source segments: ${Math.max(0,t|0)}, levels: ${r})`)}function J(e){return!Number.isFinite(e)||e<=0?0:e>=1?1:e}function Qs(e,t,n){return e<t?t:e>n?n:e}function Y(e,t,n){return e<t?t:e>n?n:e}const $s=/* @__PURE__ */ new WeakMap,ec=/* @__PURE__ */ new WeakMap,tc=/* @__PURE__ */ new WeakMap;function nc(e,t){let n=Object.assign(Object.defineProperties({},Object.getOwnPropertyDescriptors(e)),t.literals);st(n,t.origins);let r={canonical:e,literals:n},i=ec.get(t);if(!i){let e=us(ms(r,0,1));i={bounds:e,allLevelBounds:us(rc(e,t.levels))},ec.set(t,i)}let a=i.bounds;return{tileGrid:t.tileGrid,elapsedMs:0,allLevelBounds:i.allLevelBounds,levels:t.levels.map(e=>new ps(r,e,e,a))}}function*rc(e,t,n=.99){let r={minX:1/0,minY:1/0,maxX:-1/0,maxY:-1/0};for(let i of t)for(let t=0;t<i.segmentCount;t++){let a=i.records?i.records[t]:t;r.minX=Math.min(r.minX,e.minX[a]),r.minY=Math.min(r.minY,e.minY[a]),r.maxX=Math.max(r.maxX,e.maxX[a]),r.maxY=Math.max(r.maxY,e.maxY[a]),t&8191||(yield{value:n,message:`Finalizing Vector LOD bounds`,yieldable:!0})}return r}const ic=[1,.921,.231,.35],ac=[.792,.541,.016,1],oc=[1,.596,0,.45],sc=[.918,.345,.047,1],cc=[.259,.522,.957,.35],lc=[.106,.365,.788,1],uc=1e-4,dc=1e-5,fc=2e4,pc=160/255,mc=169/255,hc=175/255;function gc(e,t,n){return!e.monochrome&&!!e.gpuCompression&&e.gpuCompression.format===n&&ie(e.gpuCompression.plan,t)&&e.gpuCompression.tiles.length===t.tiles.length}function _c(e,t){return!!e.gpuPreparation&&ie(e.gpuPreparation.plan,t)}const vc=Float32Array.of(0,0,1,1),yc=Float32Array.of(0,0,0,0);var bc=class{canvas;thumbnailMode;gl;segmentProgram;fillProgram;gradientFillProgram;gradientStrokeProgram;textProgram;vectorCompositeProgram;rasterProgram;pageBackgroundProgram;pageBackgroundUniforms;pageBackgroundVao;pageBackgroundBuffer;highlightProgram;segmentVao;fillVao;gradientPaintVao;textVao;blitVao;highlightOthersVao;highlightCurrentVao;highlightSelectionVao;cornerBuffer;allSegmentIdBuffer;visibleSegmentIdBuffer;allFillPathIdBuffer;allTextInstanceIdBuffer;selectedTextInstanceIdBuffer;highlightOthersBuffer;highlightCurrentBuffer;highlightSelectionBuffer;highlightOthersCount=0;highlightCurrentCount=0;highlightSelectionCount=0;segmentTextureA;segmentTextureB;segmentTextureC;segmentTextureD;fillPathMetaTextureA;fillPathMetaTextureB;fillPathMetaTextureC;fillSegmentTextureA;fillSegmentTextureB;textInstanceTextureA;textInstanceTextureB;textInstanceTextureC;textGlyphMetaTextureA;textGlyphMetaTextureB;textGlyphRasterMetaTexture;textGlyphSegmentTextureA;textGlyphSegmentTextureB;textRasterAtlasTexture;pageBackgroundTexture;gradientMetaTextures;gradientLutTexture;gradientFillTextures;gradientStrokeTextures;gradientFillUniforms;gradientMeshProgram=null;gradientMeshUniforms={};gradientMeshBuffer=null;gradientMeshVao=null;gradientMeshRanges=/* @__PURE__ */ new Uint32Array;gradientStrokeUniforms;uSegmentTexA;uSegmentTexB;uSegmentStyleTex;uSegmentBoundsTex;uSegmentTexSize;uViewport;uCameraCenter;uZoom;uAAScreenPx;uUseLocalToClip;uLocalToClip;uLocalUnitsPerPixel;uStrokeCurveEnabled;uStrokeVectorOverride;uFillPathMetaTexA;uFillPathMetaTexB;uFillPathMetaTexC;uFillSegmentTexA;uFillSegmentTexB;uFillPathMetaTexSize;uFillSegmentTexSize;uFillViewport;uFillCameraCenter;uFillZoom;uFillAAScreenPx;uFillBandBase;uFillCellHeaders;uFillClipBoundsEnabled;uFillClipBoundsTex;uFillBandEntries;fillBandBase=-1;fillBandEntries=0;fillCellBase=-1;uFillUseLocalToClip;uFillLocalToClip;uFillVectorOverride;uTextInstanceTexA;uTextInstanceTexB;uTextInstanceTexC;uTextGlyphMetaTexA;uTextGlyphMetaTexB;uTextGlyphRasterMetaTex;uTextGlyphSegmentTexA;uTextGlyphSegmentTexB;uTextInstanceTexSize;uTextGlyphMetaTexSize;uTextGlyphSegmentTexSize;uTextViewport;uTextCameraCenter;uTextZoom;uTextAAScreenPx;uTextUseLocalToClip;uTextLocalToClip;uTextCurveEnabled;uTextRasterAtlasTex;uTextRasterAtlasSize;uTextVectorOnly;uTextVectorOverride;uVectorLayerTex;uVectorLayerViewportPx;uRasterTex;uRasterMonoMips;uRasterMonochrome;uRasterOpaque;uRasterMonoSize;uRasterMonoColor0;uRasterMonoColor1;uRasterOpacity;uRasterMatrixABCD;uRasterMatrixEF;uRasterQuad;uRasterUv;uRasterSeamBounds;uRasterSeamGaps;uRasterSeamMaxFootprint;rasterTileSeams=/* @__PURE__ */ new Map;uRasterViewport;uRasterCameraCenter;uRasterZoom;uRasterUseLocalToClip;uRasterLocalToClip;uHighlightViewport;uHighlightCameraCenter;uHighlightZoom;uHighlightUseLocalToClip;uHighlightLocalToClip;uHighlightBorderPx;uHighlightMinSizePx;uHighlightFillColor;uHighlightBorderColor;multiplyPass=null;multiplyUniforms=/* @__PURE__ */ new Map;orderedRunCuller=null;orderedCullingBounds=null;orderedRunsCulled=!1;vectorClipTexture=null;vectorClipHeaders=null;vectorClipBounds=/* @__PURE__ */ new Float32Array;vectorClipBoundsTexture=null;vectorClipStoreTexels=0;vectorClipPackingStats=null;vectorClipIndex=-1;orderedBatches=null;runLookup=null;orderedInstanceBuffer=null;mixedVectorBatchingEnabled=!0;mixedVectorBatchingUnavailable=!1;mixedVectorBatches=null;fillCoverageMetadata=null;mixedVectorGpu=null;lastMixedVectorDrawFirst=0;orderedUniformPrograms=/* @__PURE__ */ new Set;orderedTextureBindings=[];orderedDedicatedTextureUnits;fillClipBoundsUnit;orderedPaintUniformStates=/* @__PURE__ */ new Map;orderedClipStates;orderedStateActive=!1;paintFoldUnit;paintFoldNeutralTexture=null;paintFold=null;paintFoldStates;paintFoldUniforms=/* @__PURE__ */ new Map;orderedInstanceVaos=/* @__PURE__ */ new Set;vectorClipUniforms=/* @__PURE__ */ new Map;scene=null;rasterLayerUpdates=/* @__PURE__ */ new Map;paintCompositor=null;paintShapeOnly=!1;paintShapeUniforms=/* @__PURE__ */ new Map;optionalContentVisibility=null;scenePaintVisibility=null;primitiveColors=null;primitiveHighlights=null;grid=null;sceneStats=null;vectorLodMode=`auto`;vectorLodRuntime=null;vectorLodLevels=[];vectorLodStats=null;allSegmentIds=/* @__PURE__ */ new Float32Array;visibleSegmentIds=/* @__PURE__ */ new Float32Array;allFillPathIds=/* @__PURE__ */ new Float32Array;allTextInstanceIds=/* @__PURE__ */ new Float32Array;textLodMode=`auto`;textLodRuntime=null;orderedTextLod=null;textLodGpuActive=!1;selectedTextInstanceIds=/* @__PURE__ */ new Float32Array;selectedTextInstanceCount=0;segmentMarks=/* @__PURE__ */ new Uint32Array;segmentMinX=/* @__PURE__ */ new Float32Array;segmentMinY=/* @__PURE__ */ new Float32Array;segmentMaxX=/* @__PURE__ */ new Float32Array;segmentMaxY=/* @__PURE__ */ new Float32Array;markToken=1;segmentCount=0;fillPathCount=0;textInstanceCount=0;rasterLayers=[];rasterResolutionPlanner=null;rasterResolutionView=null;rasterResolutionSources=null;rasterStagedBytes=0;rasterCompression=null;rasterStripBatches=/* @__PURE__ */ new Map;rasterStripProgram=null;rasterAtlasBatches=/* @__PURE__ */ new Map;rasterAtlasProgram=null;rasterTextureBatch=null;rasterTextureBatchUnavailable=!1;rasterTextureBatchInstances=null;rasterTextureBatchCache=[];rasterTextureBatchCacheBytes=0;rasterTextureBatchCacheCursor=0;rasterTextureBatchCacheUnavailable=!1;rasterTextureClipBounds=/* @__PURE__ */ new WeakMap;rasterTextureResidencyEnabled=!0;gradientData=null;orderedGradientPaintCommands=[];gradientPaintRequiresDirectRendering=!1;gradientTextureWidth=1;gradientTextureHeight=1;gradientFillPathTextureWidth=1;gradientFillPathTextureHeight=1;gradientFillBandBase=-1;gradientFillBandEntries=0;gradientFillCellBase=-1;gradientFillSegmentTextureWidth=1;gradientFillSegmentTextureHeight=1;gradientStrokeRunTextureWidth=1;gradientStrokeRunTextureHeight=1;gradientStrokeSegmentTextureWidth=1;gradientStrokeSegmentTextureHeight=1;pageRects=/* @__PURE__ */ new Float32Array;pageTextRanges=/* @__PURE__ */ new Uint32Array;visiblePageRectIndices=/* @__PURE__ */ new Uint32Array;visiblePageRectCount=0;pageBackgroundSourceRects=null;pageBackgroundPageIndices=/* @__PURE__ */ new Uint32Array;pageBackgroundInstanceRects=/* @__PURE__ */ new Float32Array;pageBackgroundInstanceCount=0;visibleTextRanges=[];visibleSegmentCount=0;usingAllSegments=!0;segmentTextureWidth=1;segmentTextureHeight=1;fillPathMetaTextureWidth=1;fillPathMetaTextureHeight=1;fillSegmentTextureWidth=1;fillSegmentTextureHeight=1;textInstanceTextureWidth=1;textInstanceTextureHeight=1;textGlyphMetaTextureWidth=1;textGlyphMetaTextureHeight=1;textRasterAtlasWidth=1;textRasterAtlasHeight=1;textGlyphSegmentTextureWidth=1;textGlyphSegmentTextureHeight=1;needsVisibleSetUpdate=!1;rafHandle=0;frameListener=null;frameDrawCalls=0;lastFillDrawFirst=0;lastGradientFillDrawIndex=0;performanceProfiler=null;interactionViewportProvider=null;externalFrameDriver=!1;presentedCameraCenterX=0;presentedCameraCenterY=0;presentedZoom=1;presentedFrameSerial=0;cameraCenterX=0;cameraCenterY=0;zoom=1;targetCameraCenterX=0;targetCameraCenterY=0;targetZoom=1;lastCameraAnimationTimeMs=0;hasZoomAnchor=!1;zoomAnchorClientX=0;zoomAnchorClientY=0;zoomAnchorWorldX=0;zoomAnchorWorldY=0;panVelocityWorldX=0;panVelocityWorldY=0;lastPanVelocityUpdateTimeMs=0;lastPanFrameCameraX=0;lastPanFrameCameraY=0;lastPanFrameTimeMs=0;minZoom=.01;maxZoom=4096;isPanInteracting=!1;vectorMinifyTexture=null;vectorMinifyFramebuffer=null;vectorMinifyWidth=0;vectorMinifyHeight=0;vectorMinifyWarmupPending=!1;rasterRenderingEnabled=!0;fillRenderingEnabled=!0;strokeRenderingEnabled=!0;textRenderingEnabled=!0;strokeCurveEnabled=!0;textVectorOnly=!1;hasCameraInteractionSinceSceneLoad=!1;pageBackgroundColor=[1,1,1,1];vectorOverrideColor=[0,0,0];vectorOverrideOpacity=0;localToClipRenderingEnabled=!1;localToClipMatrix=/* @__PURE__ */ new Float32Array(16);localUnitsPerPixel=1;isDisposed=!1;constructor(e,t={}){this.canvas=e,this.thumbnailMode=t.thumbnail===!0,this.thumbnailMode&&(this.externalFrameDriver=!0,this.vectorLodMode=`off`,this.textLodMode=`off`,this.textVectorOnly=!0);let n=e.getContext(`webgl2`,{antialias:!1,depth:!1,stencil:!1,alpha:this.thumbnailMode,premultipliedAlpha:this.thumbnailMode,powerPreference:`high-performance`,preserveDrawingBuffer:t.preserveDrawingBuffer===!0});if(!n)throw Error(`WebGL2 is required for this proof-of-concept renderer.`);this.gl=n,this.mixedVectorBatchingEnabled=t.mixedVectorBatching!==!1;let r=n.getParameter(n.MAX_COMBINED_TEXTURE_IMAGE_UNITS);this.orderedDedicatedTextureUnits=r>=19,this.fillClipBoundsUnit=r>=27?26:14,this.paintFoldUnit=r>27?27:-1;let i=(e,t)=>this.paintFoldUnit>=0?Jr(e,t):e;this.segmentProgram=this.createProgram(vn,Ci(yn,!0)),this.fillProgram=this.createProgram(bn,Ci(i(xn,!1),!0)),this.gradientFillProgram=this.createProgram(hr,i(gr,!1)),this.gradientStrokeProgram=this.createProgram(`#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uRunMetaTexA;
uniform sampler2D uEndpointsTex;
uniform sampler2D uPrimitiveMetaTex;
uniform sampler2D uPrimitiveBoundsTex;
uniform sampler2D uStylesTex;
uniform ivec2 uRunMetaTexSize;
uniform ivec2 uSegmentTexSize;
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
flat out vec3 vSolidColor;
flat out float vAlpha;
flat out vec4 vClipBounds;
flat out float vHasClipBounds;
flat out int vSourceGradientIndex;
flat out int vMaskGradientIndex;

ivec2 coordFromIndex(int index, ivec2 sizeValue) {
  return ivec2(index % sizeValue.x, index / sizeValue.x);
}

vec2 cornerFromIndex(int index) {
  if (index == 0) return vec2(-1.0, -1.0);
  if (index == 1) return vec2(1.0, -1.0);
  if (index == 2) return vec2(-1.0, 1.0);
  return vec2(1.0, 1.0);
}

void main() {
  int runIndex = gl_VertexID / 4;
  int cornerIndex = gl_VertexID - runIndex * 4;
  vec4 runMeta = texelFetch(uRunMetaTexA, coordFromIndex(runIndex, uRunMetaTexSize), 0);
  int segmentIndex = int(runMeta.x) + gl_InstanceID;
  ivec2 segmentCoord = coordFromIndex(segmentIndex, uSegmentTexSize);
  vec4 primitiveA = texelFetch(uEndpointsTex, segmentCoord, 0);
  vec4 primitiveB = texelFetch(uPrimitiveMetaTex, segmentCoord, 0);
  vec4 bounds = texelFetch(uPrimitiveBoundsTex, segmentCoord, 0);
  vec4 style = texelFetch(uStylesTex, segmentCoord, 0);

  vec2 p0 = primitiveA.xy;
  vec2 p1 = primitiveA.zw;
  vec2 p2 = primitiveB.xy;
  float primitiveType = primitiveB.z;
  float packedStyle = primitiveB.w;
  float styleFlags = floor(packedStyle / 2.0 + 1e-6);
  float alpha = packedStyle - styleFlags * 2.0;
  bool isHairline = mod(styleFlags, 2.0) >= 0.5;
  bool isRoundCap = mod(floor(styleFlags * 0.5), 2.0) >= 0.5;
  bool hasClipBounds = mod(floor(styleFlags * 0.25), 2.0) >= 0.5;
  float localUnitsPerPixel = uUseLocalToClip >= 0.5 ? max(uLocalUnitsPerPixel, 1e-6) : 1.0 / max(uZoom, 1e-4);
  float halfWidth = isHairline ? max(0.5 * localUnitsPerPixel, 1e-5) : style.x;
  float aaWorld = isHairline
    ? max(0.35 * localUnitsPerPixel, 5e-5)
    : max(localUnitsPerPixel, 0.0001) * uAAScreenPx;
  float geometryLength = primitiveType >= 0.5 ? length(p1 - p0) + length(p2 - p1) : length(p2 - p0);
  if ((geometryLength == 0.0 && !isRoundCap) || alpha <= 0.001) {
    gl_Position = vec4(-2.0, -2.0, 0.0, 1.0);
    vAlpha = 0.0;
    return;
  }

  float extent = halfWidth + aaWorld;
  vec2 axisDelta = p2 - p0;
  float axisLength = length(axisDelta);
  vec2 axisU = axisLength > 1e-6 ? axisDelta / axisLength : vec2(1.0, 0.0);
  vec2 axisV = vec2(-axisU.y, axisU.x);
  vec2 control = p1 - p0;
  float controlU = dot(control, axisU);
  float controlV = dot(control, axisV);
  vec2 corner01 = cornerFromIndex(cornerIndex) * 0.5 + 0.5;
  vec2 worldMin = bounds.xy - vec2(extent);
  vec2 worldMax = bounds.zw + vec2(extent);
  float minU = min(min(0.0, controlU), axisLength) - extent;
  float maxU = max(max(0.0, controlU), axisLength) + extent;
  float minV = min(0.0, controlV) - extent;
  float maxV = max(0.0, controlV) + extent;
  float axisArea = (worldMax.x - worldMin.x) * (worldMax.y - worldMin.y);
  float orientedArea = (maxU - minU) * (maxV - minV);
  vec2 world = orientedArea < axisArea
    ? p0 + axisU * mix(minU, maxU, corner01.x) + axisV * mix(minV, maxV, corner01.y)
    : mix(worldMin, worldMax, corner01);

  if (uUseLocalToClip >= 0.5) {
    gl_Position = uLocalToClip * vec4(world, 0.0, 1.0);
  } else {
    vec2 screen = (world - uCameraCenter) * uZoom + 0.5 * uViewport;
    gl_Position = vec4((screen / (0.5 * uViewport)) - 1.0, 0.0, 1.0);
  }
  vLocal = world;
  vP0 = p0;
  vP1 = p1;
  vP2 = p2;
  vPrimitiveType = primitiveType;
  vIsHairline = isHairline ? 1.0 : 0.0;
  vHalfWidth = halfWidth;
  vSolidColor = style.yzw;
  vAlpha = alpha;
  vClipBounds = bounds;
  vHasClipBounds = hasClipBounds ? 1.0 : 0.0;
  vSourceGradientIndex = int(round(runMeta.z));
  vMaskGradientIndex = int(round(runMeta.w));
}
`,_r),this.textProgram=this.createProgram(Sn,Ci(Cn,!0)),this.vectorCompositeProgram=this.thumbnailMode?null:this.createProgram(`#version 300 es
precision highp float;

layout(location = 0) in vec2 aCorner;

void main() {
  gl_Position = vec4(aCorner, 0.0, 1.0);
}
`,`#version 300 es
precision highp float;

uniform sampler2D uVectorLayerTex;
uniform vec2 uViewportPx;

out vec4 outColor;

void main() {
  vec2 uv = gl_FragCoord.xy / max(uViewportPx, vec2(1.0));
  outColor = texture(uVectorLayerTex, clamp(uv, vec2(0.0), vec2(1.0)));
}
`),this.rasterProgram=this.createProgram(qn(wn),i(Zn(Jn(Tn)),!0)),this.pageBackgroundProgram=this.createProgram(tr(wn).replace(`#version 300 es`,`#version 300 es
#define INSTANCED_PAGE_BACKGROUNDS`),i(nr(Tn),!0)),this.pageBackgroundUniforms=this.mustGetUniformMap(this.pageBackgroundProgram,[`uRasterTex`,`uRasterOpacity`,`uViewport`,`uCameraCenter`,`uZoom`,`uUseLocalToClip`,`uLocalToClip`,`uPagePlaceholderTime`]),this.highlightProgram=this.thumbnailMode?null:this.createProgram(`#version 300 es
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
`,`#version 300 es
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
`),this.segmentVao=this.createVertexArray(),this.fillVao=this.createVertexArray(),this.gradientPaintVao=this.createVertexArray(),this.textVao=this.createVertexArray(),this.blitVao=this.createVertexArray(),this.pageBackgroundVao=this.createVertexArray(),this.highlightOthersVao=this.thumbnailMode?null:this.createVertexArray(),this.highlightCurrentVao=this.thumbnailMode?null:this.createVertexArray(),this.highlightSelectionVao=this.thumbnailMode?null:this.createVertexArray(),this.cornerBuffer=this.mustCreateBuffer(),this.pageBackgroundBuffer=this.mustCreateBuffer(),this.allSegmentIdBuffer=this.mustCreateBuffer(),this.visibleSegmentIdBuffer=this.mustCreateBuffer(),this.allFillPathIdBuffer=this.mustCreateBuffer(),this.allTextInstanceIdBuffer=this.mustCreateBuffer(),this.selectedTextInstanceIdBuffer=this.thumbnailMode?null:this.mustCreateBuffer(),this.highlightOthersBuffer=this.thumbnailMode?null:this.mustCreateBuffer(),this.highlightCurrentBuffer=this.thumbnailMode?null:this.mustCreateBuffer(),this.highlightSelectionBuffer=this.thumbnailMode?null:this.mustCreateBuffer(),this.segmentTextureA=this.mustCreateTexture(),this.segmentTextureB=this.mustCreateTexture(),this.segmentTextureC=this.mustCreateTexture(),this.segmentTextureD=this.mustCreateTexture(),this.fillPathMetaTextureA=this.mustCreateTexture(),this.fillPathMetaTextureB=this.mustCreateTexture(),this.fillPathMetaTextureC=this.mustCreateTexture(),this.fillSegmentTextureA=this.mustCreateTexture(),this.fillSegmentTextureB=this.mustCreateTexture(),this.textInstanceTextureA=this.mustCreateTexture(),this.textInstanceTextureB=this.mustCreateTexture(),this.textInstanceTextureC=this.mustCreateTexture(),this.textGlyphMetaTextureA=this.mustCreateTexture(),this.textGlyphMetaTextureB=this.mustCreateTexture(),this.textGlyphRasterMetaTexture=this.mustCreateTexture(),this.textGlyphSegmentTextureA=this.mustCreateTexture(),this.textGlyphSegmentTextureB=this.mustCreateTexture(),this.textRasterAtlasTexture=this.mustCreateTexture(),this.pageBackgroundTexture=this.mustCreateTexture(),this.gradientMetaTextures=Array.from({length:5},()=>this.mustCreateTexture()),this.gradientLutTexture=this.mustCreateTexture(),this.gradientFillTextures=Array.from({length:6},()=>this.mustCreateTexture()),this.gradientStrokeTextures=Array.from({length:5},()=>this.mustCreateTexture()),this.gradientFillUniforms=this.mustGetUniformMap(this.gradientFillProgram,/* @__PURE__ */ `uPathMetaTexA.uPathMetaTexB.uPathMetaTexC.uPaintMetaTex.uPathMetaTexSize.uSegmentTexA.uSegmentTexB.uSegmentTexSize.uGradientMetaTexA.uGradientMetaTexB.uGradientMetaTexC.uGradientMetaTexD.uGradientMetaTexE.uGradientLutTex.uGradientMetaTexSize.uGradientCount.uViewport.uCameraCenter.uZoom.uAAScreenPx.uUseLocalToClip.uLocalToClip.uVectorOverride.uPrimitiveOverride.uBandBase.uBandEntries.uCellHeaders.uClipBounds`.split(`.`)),this.gradientStrokeUniforms=this.mustGetUniformMap(this.gradientStrokeProgram,[`uRunMetaTexA`,`uEndpointsTex`,`uPrimitiveMetaTex`,`uPrimitiveBoundsTex`,`uStylesTex`,`uRunMetaTexSize`,`uSegmentTexSize`,`uGradientMetaTexA`,`uGradientMetaTexB`,`uGradientMetaTexC`,`uGradientMetaTexD`,`uGradientMetaTexE`,`uGradientLutTex`,`uGradientMetaTexSize`,`uGradientCount`,`uViewport`,`uCameraCenter`,`uZoom`,`uAAScreenPx`,`uUseLocalToClip`,`uLocalToClip`,`uLocalUnitsPerPixel`,`uStrokeCurveEnabled`,`uVectorOverride`,`uPrimitiveOverride`]),this.uSegmentTexA=this.mustGetUniformLocation(this.segmentProgram,`uSegmentTexA`),this.uSegmentTexB=this.mustGetUniformLocation(this.segmentProgram,`uSegmentTexB`),this.uSegmentStyleTex=this.mustGetUniformLocation(this.segmentProgram,`uSegmentStyleTex`),this.uSegmentBoundsTex=this.mustGetUniformLocation(this.segmentProgram,`uSegmentBoundsTex`),this.uSegmentTexSize=this.mustGetUniformLocation(this.segmentProgram,`uSegmentTexSize`),this.uViewport=this.mustGetUniformLocation(this.segmentProgram,`uViewport`),this.uCameraCenter=this.mustGetUniformLocation(this.segmentProgram,`uCameraCenter`),this.uZoom=this.mustGetUniformLocation(this.segmentProgram,`uZoom`),this.uAAScreenPx=this.mustGetUniformLocation(this.segmentProgram,`uAAScreenPx`),this.uUseLocalToClip=this.mustGetUniformLocation(this.segmentProgram,`uUseLocalToClip`),this.uLocalToClip=this.mustGetUniformLocation(this.segmentProgram,`uLocalToClip`),this.uLocalUnitsPerPixel=this.mustGetUniformLocation(this.segmentProgram,`uLocalUnitsPerPixel`),this.uStrokeCurveEnabled=this.mustGetUniformLocation(this.segmentProgram,`uStrokeCurveEnabled`),this.uStrokeVectorOverride=this.mustGetUniformLocation(this.segmentProgram,`uVectorOverride`),this.uFillPathMetaTexA=this.mustGetUniformLocation(this.fillProgram,`uFillPathMetaTexA`),this.uFillPathMetaTexB=this.mustGetUniformLocation(this.fillProgram,`uFillPathMetaTexB`),this.uFillPathMetaTexC=this.mustGetUniformLocation(this.fillProgram,`uFillPathMetaTexC`),this.uFillSegmentTexA=this.mustGetUniformLocation(this.fillProgram,`uFillSegmentTexA`),this.uFillSegmentTexB=this.mustGetUniformLocation(this.fillProgram,`uFillSegmentTexB`),this.uFillPathMetaTexSize=this.mustGetUniformLocation(this.fillProgram,`uFillPathMetaTexSize`),this.uFillSegmentTexSize=this.mustGetUniformLocation(this.fillProgram,`uFillSegmentTexSize`),this.uFillViewport=this.mustGetUniformLocation(this.fillProgram,`uViewport`),this.uFillCameraCenter=this.mustGetUniformLocation(this.fillProgram,`uCameraCenter`),this.uFillZoom=this.mustGetUniformLocation(this.fillProgram,`uZoom`),this.uFillAAScreenPx=this.mustGetUniformLocation(this.fillProgram,`uFillAAScreenPx`),this.uFillBandBase=this.mustGetUniformLocation(this.fillProgram,`uFillBandBase`),this.uFillCellHeaders=this.mustGetUniformLocation(this.fillProgram,`uFillCellHeaders`),this.uFillClipBoundsEnabled=this.mustGetUniformLocation(this.fillProgram,`uFillClipBoundsEnabled`),this.uFillClipBoundsTex=this.mustGetUniformLocation(this.fillProgram,`uFillClipBoundsTex`),this.uFillBandEntries=this.mustGetUniformLocation(this.fillProgram,`uFillBandEntries`),this.uFillUseLocalToClip=this.mustGetUniformLocation(this.fillProgram,`uUseLocalToClip`),this.uFillLocalToClip=this.mustGetUniformLocation(this.fillProgram,`uLocalToClip`),this.uFillVectorOverride=this.mustGetUniformLocation(this.fillProgram,`uVectorOverride`),this.uTextInstanceTexA=this.mustGetUniformLocation(this.textProgram,`uTextInstanceTexA`),this.uTextInstanceTexB=this.mustGetUniformLocation(this.textProgram,`uTextInstanceTexB`),this.uTextInstanceTexC=this.mustGetUniformLocation(this.textProgram,`uTextInstanceTexC`),this.uTextGlyphMetaTexA=this.mustGetUniformLocation(this.textProgram,`uTextGlyphMetaTexA`),this.uTextGlyphMetaTexB=this.mustGetUniformLocation(this.textProgram,`uTextGlyphMetaTexB`),this.uTextGlyphRasterMetaTex=this.mustGetUniformLocation(this.textProgram,`uTextGlyphRasterMetaTex`),this.uTextGlyphSegmentTexA=this.mustGetUniformLocation(this.textProgram,`uTextGlyphSegmentTexA`),this.uTextGlyphSegmentTexB=this.mustGetUniformLocation(this.textProgram,`uTextGlyphSegmentTexB`),this.uTextInstanceTexSize=this.mustGetUniformLocation(this.textProgram,`uTextInstanceTexSize`),this.uTextGlyphMetaTexSize=this.mustGetUniformLocation(this.textProgram,`uTextGlyphMetaTexSize`),this.uTextGlyphSegmentTexSize=this.mustGetUniformLocation(this.textProgram,`uTextGlyphSegmentTexSize`),this.uTextViewport=this.mustGetUniformLocation(this.textProgram,`uViewport`),this.uTextCameraCenter=this.mustGetUniformLocation(this.textProgram,`uCameraCenter`),this.uTextZoom=this.mustGetUniformLocation(this.textProgram,`uZoom`),this.uTextAAScreenPx=this.mustGetUniformLocation(this.textProgram,`uTextAAScreenPx`),this.uTextUseLocalToClip=this.mustGetUniformLocation(this.textProgram,`uUseLocalToClip`),this.uTextLocalToClip=this.mustGetUniformLocation(this.textProgram,`uLocalToClip`),this.uTextCurveEnabled=this.mustGetUniformLocation(this.textProgram,`uTextCurveEnabled`),this.uTextRasterAtlasTex=this.mustGetUniformLocation(this.textProgram,`uTextRasterAtlasTex`),this.uTextRasterAtlasSize=this.mustGetUniformLocation(this.textProgram,`uTextRasterAtlasSize`),this.uTextVectorOnly=this.mustGetUniformLocation(this.textProgram,`uTextVectorOnly`),this.uTextVectorOverride=this.mustGetUniformLocation(this.textProgram,`uVectorOverride`),this.uVectorLayerTex=this.vectorCompositeProgram?this.mustGetUniformLocation(this.vectorCompositeProgram,`uVectorLayerTex`):null,this.uVectorLayerViewportPx=this.vectorCompositeProgram?this.mustGetUniformLocation(this.vectorCompositeProgram,`uViewportPx`):null,this.uRasterTex=this.mustGetUniformLocation(this.rasterProgram,`uRasterTex`),this.uRasterMonoMips=this.mustGetUniformLocation(this.rasterProgram,`uRasterMonoMips`),this.uRasterMonochrome=this.mustGetUniformLocation(this.rasterProgram,`uRasterMonochrome`),this.uRasterOpaque=this.mustGetUniformLocation(this.rasterProgram,`uRasterOpaque`),this.uRasterMonoSize=this.mustGetUniformLocation(this.rasterProgram,`uRasterMonoSize`),this.uRasterMonoColor0=this.mustGetUniformLocation(this.rasterProgram,`uRasterMonoColor0`),this.uRasterMonoColor1=this.mustGetUniformLocation(this.rasterProgram,`uRasterMonoColor1`),this.uRasterOpacity=this.mustGetUniformLocation(this.rasterProgram,`uRasterOpacity`),this.uRasterMatrixABCD=this.mustGetUniformLocation(this.rasterProgram,`uRasterMatrixABCD`),this.uRasterMatrixEF=this.mustGetUniformLocation(this.rasterProgram,`uRasterMatrixEF`),this.uRasterQuad=this.mustGetUniformLocation(this.rasterProgram,`uRasterQuad`),this.uRasterUv=this.mustGetUniformLocation(this.rasterProgram,`uRasterUv`),this.uRasterSeamBounds=this.mustGetUniformLocation(this.rasterProgram,`uRasterSeamBounds`),this.uRasterSeamGaps=this.mustGetUniformLocation(this.rasterProgram,`uRasterSeamGaps`),this.uRasterSeamMaxFootprint=this.mustGetUniformLocation(this.rasterProgram,`uRasterSeamMaxFootprint`),this.uRasterViewport=this.mustGetUniformLocation(this.rasterProgram,`uViewport`),this.uRasterCameraCenter=this.mustGetUniformLocation(this.rasterProgram,`uCameraCenter`),this.uRasterZoom=this.mustGetUniformLocation(this.rasterProgram,`uZoom`),this.uRasterUseLocalToClip=this.mustGetUniformLocation(this.rasterProgram,`uUseLocalToClip`),this.uRasterLocalToClip=this.mustGetUniformLocation(this.rasterProgram,`uLocalToClip`),this.uHighlightViewport=this.highlightProgram?this.mustGetUniformLocation(this.highlightProgram,`uViewport`):null,this.uHighlightCameraCenter=this.highlightProgram?this.mustGetUniformLocation(this.highlightProgram,`uCameraCenter`):null,this.uHighlightZoom=this.highlightProgram?this.mustGetUniformLocation(this.highlightProgram,`uZoom`):null,this.uHighlightUseLocalToClip=this.highlightProgram?this.mustGetUniformLocation(this.highlightProgram,`uUseLocalToClip`):null,this.uHighlightLocalToClip=this.highlightProgram?this.mustGetUniformLocation(this.highlightProgram,`uLocalToClip`):null,this.uHighlightBorderPx=this.highlightProgram?this.mustGetUniformLocation(this.highlightProgram,`uBorderPx`):null,this.uHighlightMinSizePx=this.highlightProgram?this.mustGetUniformLocation(this.highlightProgram,`uMinSizePx`):null,this.uHighlightFillColor=this.highlightProgram?this.mustGetUniformLocation(this.highlightProgram,`uFillColor`):null,this.uHighlightBorderColor=this.highlightProgram?this.mustGetUniformLocation(this.highlightProgram,`uBorderColor`):null,this.paintFoldUnit>=0&&this.initializePaintFold(),this.initializeGeometry(),this.initializeState(),this.uploadPageBackgroundTexture()}setFrameListener(e){this.frameListener=e}getPerformanceProfiler(){if(this.isDisposed)throw Error(`Cannot profile a disposed renderer.`);return this.performanceProfiler??=new ri({gl:this.gl,describeProgram:e=>this.describeProgram(e),describeDraw:(e,t)=>this.describeDrawSource(e,t)})}describeDrawSource(e,t){if(!e)return;if(e===this.mixedVectorGpu?.program&&this.mixedVectorBatches){let e=this.lastMixedVectorDrawFirst,n=this.mixedVectorBatches.floatInstances,r=[],i=[],a=[];for(let o=e;o<e+Math.min(t,32);o++)r.push(n[o*3]),i.push(n[o*3+1]-1),a.push(n[o*3+2]===1?`fill`:`stroke`);return{kind:`mixed-vector`,first:e,indirect:!0,ids:r,clips:i,kinds:a,truncated:t>r.length}}if(e===this.gradientFillProgram||e===this.gradientMeshProgram)return{kind:`gradient-fill`,first:this.lastGradientFillDrawIndex,indirect:!1,ids:[this.lastGradientFillDrawIndex],clips:[this.vectorClipIndex],truncated:!1};if(e!==this.fillProgram)return;let n=this.lastFillDrawFirst,r=this.vectorClipIndex===-2,i=[],a=[],o=this.orderedBatches?.uintInstances;if(!r||o){for(let e=0;e<Math.min(t,32);e++)i.push(r?o[(n+e)*2]:n+e),a.push(r?o[(n+e)*2+1]-1:this.vectorClipIndex);return{kind:`fill`,first:n,indirect:r,ids:i,clips:a,truncated:t>i.length}}}describeProgram(e){if(!e)return null;let t=this.paintCompositor;return t&&e===t.program?`composite:${t.lastPassName}`:[[this.segmentProgram,`stroke`],[this.fillProgram,`fill`],[this.gradientFillProgram,`gradientFill`],[this.mixedVectorGpu?.program,`mixedVector`],[this.gradientMeshProgram,`gradientMesh`],[this.gradientStrokeProgram,`gradientStroke`],[this.textProgram,`text`],[this.rasterProgram,`raster`],[this.rasterStripProgram?.program,`rasterStrip`],[this.rasterAtlasProgram?.program,`rasterAtlas`],[this.rasterRepeatProgram?.program,`rasterRepeat`],[this.rasterTextureBatch?.program,`rasterTextureBatch`],[this.pageBackgroundProgram,`pageBackground`],[this.vectorCompositeProgram,`vectorComposite`],[this.highlightProgram,`highlight`]].find(([t])=>t===e)?.[1]??null}emitFrameStats(e){e.drawCalls=this.frameDrawCalls;let t=this.performanceProfiler?.enabled?this.performanceProfiler:null;t?.beginSection(`viewerCallback`);try{this.frameListener?.(e)}finally{t?.endSection(`viewerCallback`)}}setExternalFrameDriver(e){let t=!!e;this.externalFrameDriver!==t&&(this.externalFrameDriver=t,this.externalFrameDriver&&this.rafHandle!==0&&(cancelAnimationFrame(this.rafHandle),this.rafHandle=0))}renderExternalFrame(e=performance.now()){this.render(e)}renderThumbnailFrame(e,t,n,r,i){if(r?.throwIfAborted(),!this.thumbnailMode||this.isDisposed||!this.scene)throw Error(`A live thumbnail renderer and scene are required.`);let a=e.maxX-e.minX,o=e.maxY-e.minY;if(![e.minX,e.minY,e.maxX,e.maxY].every(Number.isFinite)||!(a>0)||!(o>0)||!Number.isSafeInteger(t)||!Number.isSafeInteger(n)||t<1||n<1)throw RangeError(`Invalid thumbnail viewport.`);if(this.canvas.width!==t||this.canvas.height!==n)throw Error(`Thumbnail backing dimensions must be set before uploading the scene.`);let s=this.gl;if(s.isContextLost())throw Error(`The thumbnail WebGL context was lost.`);if(s.drawingBufferWidth<t||s.drawingBufferHeight<n)throw RangeError(`The GPU cannot allocate the requested thumbnail dimensions.`);let c=performance.now(),l=Math.min(t/a,n/o);if(this.cameraCenterX=(e.minX+e.maxX)/2,this.cameraCenterY=(e.minY+e.maxY)/2,this.zoom=l,this.localToClipRenderingEnabled=!1,this.orderedCullingBounds=null,this.frameDrawCalls=0,this.setAllPagesAndTextVisible(),this.visibleSegmentCount=this.segmentCount,this.usingAllSegments=!0,this.ensureRenderState(),s.bindFramebuffer(s.FRAMEBUFFER,null),s.viewport(0,0,t,n),s.clearColor(0,0,0,0),s.clear(s.COLOR_BUFFER_BIT),!this.scene.drawRuns)throw Error(`Thumbnail scenes require ordered paint runs.`);this.drawSourceOrderedContent(t,n,this.cameraCenterX,this.cameraCenterY,l),i?.(`draw`,performance.now()-c),r?.throwIfAborted();let u=performance.now(),d=new Uint8Array(t*n*4);if(s.readPixels(0,0,t,n,s.RGBA,s.UNSIGNED_BYTE,d),s.isContextLost())throw Error(`The thumbnail WebGL context was lost during rendering.`);let f=t*4;for(let e=0;e<Math.ceil(n/2);e++){r?.throwIfAborted();let t=n-e-1;for(let n=0;n<f;n++){let r=e*f+n,i=t*f+n,a=d[r];d[r]=d[i],d[i]=a}}for(let e=0;e<n;e++){r?.throwIfAborted();for(let t=e*f;t<(e+1)*f;t+=4){let e=d[t+3];for(let n=0;n<3;n++)d[t+n]=e>0?Math.min(255,Math.round(d[t+n]*255/e)):0}}return i?.(`readback`,performance.now()-u),d}renderProjectedFrame(e){this.frameDrawCalls=0;let t=Math.max(1,Math.round(e.viewportWidth)),n=Math.max(1,Math.round(e.viewportHeight)),r=Math.max(1e-9,Number(e.localUnitsPerPixel));if(e.localToClip.length<16)return{drawCalls:0,renderedSegments:0,totalSegments:this.segmentCount,usedCulling:!1,zoom:1/r};for(let t=0;t<16;t+=1){let n=Number(e.localToClip[t]);if(!Number.isFinite(n))return{drawCalls:0,renderedSegments:0,totalSegments:this.segmentCount,usedCulling:!1,zoom:1/r};this.localToClipMatrix[t]=n}this.localUnitsPerPixel=r,this.localToClipRenderingEnabled=!0,this.orderedCullingBounds=e.cullingBounds??null;let i=this.gl;this.ensureRenderState(),i.bindFramebuffer(i.FRAMEBUFFER,null),i.viewport(0,0,t,n),i.clearColor(pc,mc,hc,1),i.clear(i.COLOR_BUFFER_BIT),e.cullingBounds?this.updateVisibleSetForBounds(e.cullingBounds,r,t,n):(this.setAllPagesAndTextVisible(),this.vectorLodRuntime?this.updateVectorLodVisibleSet({cameraCenterX:this.cameraCenterX,cameraCenterY:this.cameraCenterY,zoom:1/r},{width:t,height:n},null,r):(this.usingAllSegments=!0,this.visibleSegmentCount=this.segmentCount));let a;this.scene?.drawRuns?a=this.drawSourceOrderedContent(t,n,this.cameraCenterX,this.cameraCenterY,1/r):(this.drawOrderedGradientPaint(t,n,this.cameraCenterX,this.cameraCenterY,1/r),this.fillRenderingEnabled&&this.drawFilledPaths(t,n,this.cameraCenterX,this.cameraCenterY,1/r),a=this.strokeRenderingEnabled?this.drawVisibleSegments(t,n,this.cameraCenterX,this.cameraCenterY,1/r):0,this.textRenderingEnabled&&this.drawTextInstances(t,n,this.cameraCenterX,this.cameraCenterY,1/r)),this.drawSearchHighlights(t,n,this.cameraCenterX,this.cameraCenterY,1/r),this.localToClipRenderingEnabled=!1,this.orderedCullingBounds=null,i.bindVertexArray(null),this.presentedFrameSerial+=1;let o={drawCalls:this.frameDrawCalls,renderedSegments:a,totalSegments:this.segmentCount,redundantSegments:this.getRedundantSegmentCount(),paintOrderApproximated:this.isPaintOrderApproximated(),usedCulling:this.scene?.drawRuns?this.orderedRunsCulled:!this.usingAllSegments,zoom:1/r};return this.frameListener?.(o),o}setVectorLodMode(e){let t=e===`off`||e===`force`?e:`auto`;if(this.vectorLodMode!==t){if(this.vectorLodMode=t,this.scene){this.destroyVectorLodResources();let e=this.rebuildVectorLod(this.scene);this.grid=!e&&!this.scene.drawRuns&&this.segmentCount>0?oa(this.scene):null,this.destroyVectorMinifyResources(),this.needsVisibleSetUpdate=!0,this.requestFrame()}this.primitiveColors&&this.setPrimitiveColorUpdates(this.primitiveColors.updates())}}getVectorStrokeLodStats(){return this.vectorLodStats?{...this.vectorLodStats,activeLevels:this.vectorLodStats.activeLevels.map(e=>({...e}))}:null}setTextLodMode(e){let t=e===`off`?`off`:`auto`;if(this.textLodMode!==t){if(this.textLodMode=t,t===`auto`&&this.scene&&!this.textLodGpuActive){this.setScene(this.scene);return}this.textLodRuntime?.setMode(this.primitiveColors?.has(`text`)?`off`:t),this.selectedTextInstanceCount=0,this.destroyVectorMinifyResources(),this.needsVisibleSetUpdate=!0,this.requestFrame()}}getTextLodStats(){return this.textLodRuntime?.getStats()??null}setStrokeCurveEnabled(e){let t=!!e;this.strokeCurveEnabled!==t&&(this.strokeCurveEnabled=t,this.requestFrame())}setRasterRenderingEnabled(e){let t=!!e;this.rasterRenderingEnabled!==t&&(this.rasterRenderingEnabled=t,this.needsVisibleSetUpdate=!0,this.requestFrame())}setRasterTextureResidency(e){let t=!!e;if(!(this.rasterTextureResidencyEnabled===t||this.isDisposed)){if(this.rasterTextureResidencyEnabled=t,t){if(this.scene)try{this.uploadRasterLayers(this.scene)}catch(e){throw this.rasterTextureResidencyEnabled=!1,this.destroyRasterLayerTextures(),e}}else this.destroyRasterLayerTextures();this.needsVisibleSetUpdate=!0,this.requestFrame()}}setStrokeRenderingEnabled(e){let t=!!e;this.strokeRenderingEnabled!==t&&(this.strokeRenderingEnabled=t,this.needsVisibleSetUpdate=!0,this.requestFrame())}setMixedVectorBatchingEnabled(e){let t=!!e;this.mixedVectorBatchingEnabled===t||this.isDisposed||(this.mixedVectorBatchingEnabled=t,this.requestFrame())}getMixedVectorBatchingEnabled(){return this.mixedVectorBatchingEnabled}getFillRenderingEnabled(){return this.fillRenderingEnabled}getStrokeRenderingEnabled(){return this.strokeRenderingEnabled}setFillRenderingEnabled(e){let t=!!e;this.fillRenderingEnabled!==t&&(this.fillRenderingEnabled=t,this.needsVisibleSetUpdate=!0,this.requestFrame())}setTextRenderingEnabled(e){let t=!!e;this.textRenderingEnabled!==t&&(this.textRenderingEnabled=t,this.needsVisibleSetUpdate=!0,this.requestFrame())}setTextVectorOnly(e){let t=!!e;this.textVectorOnly!==t&&(this.textVectorOnly=t,this.textVectorOnly&&this.destroyVectorMinifyResources(),this.requestFrame())}setPageBackgroundColor(e,t,n,r){let i=Q(e,0,1),a=Q(t,0,1),o=Q(n,0,1),s=Q(r,0,1),c=this.pageBackgroundColor;Math.abs(c[0]-i)<=1e-6&&Math.abs(c[1]-a)<=1e-6&&Math.abs(c[2]-o)<=1e-6&&Math.abs(c[3]-s)<=1e-6||(this.pageBackgroundColor=[i,a,o,s],this.uploadPageBackgroundTexture(),this.requestFrame())}setPrimitiveHighlights(e){if(!this.isDisposed){if(!e?.count){this.primitiveHighlights?.dispose(),this.primitiveHighlights=null,this.requestFrame();return}this.primitiveHighlights||=new Si(this.gl,(e,t)=>this.createProgram(e,t)),this.primitiveHighlights?.set(e),this.requestFrame()}}setPrimitiveColorUpdates(e){if(this.isDisposed||e.length===0)return;if(!this.scene)throw Error(`Cannot apply primitive colors before uploading a scene.`);this.primitiveColors??=new _i(this.scene);let t=this.primitiveColors.update(e),n=this.fillCoverageMetadata;if(n)for(let e of t){let t=e.kind===`fillB`?n.pathMetaB:e.kind===`fillC`?n.pathMetaC:null;t&&(e.pixels[0]=t[e.index*4],e.pixels[1]=t[e.index*4+1])}let r={stroke:this.segmentTextureWidth,fillB:this.fillPathMetaTextureWidth,fillC:this.fillPathMetaTextureWidth,text:this.textInstanceTextureWidth},i=gi(t,r),a=this.gl;a.activeTexture(a.TEXTURE0);for(let e of i){let t=e.kind===`stroke`?this.segmentTextureC:e.kind===`fillB`?this.fillPathMetaTextureB:e.kind===`fillC`?this.fillPathMetaTextureC:this.textInstanceTextureC,n=r[e.kind];a.bindTexture(a.TEXTURE_2D,t),a.texSubImage2D(a.TEXTURE_2D,0,e.index%n,Math.floor(e.index/n),e.count,1,a.RGBA,e.pixels instanceof Uint8Array?a.UNSIGNED_BYTE:a.FLOAT,e.pixels)}let o=this.orderedBatches?this.vectorLodLevels[0]:void 0;if(o?.ownsTextures){let e=gi(t.filter(e=>e.kind===`stroke`),{...r,stroke:o.textureWidth});a.bindTexture(a.TEXTURE_2D,o.textureC);for(let t of e)a.texSubImage2D(a.TEXTURE_2D,0,t.index%o.textureWidth,Math.floor(t.index/o.textureWidth),t.count,1,a.RGBA,a.FLOAT,t.pixels)}this.vectorLodRuntime?.setForceExact(this.primitiveColors.has(`stroke`)),this.textLodRuntime?.setMode(this.primitiveColors.has(`text`)?`off`:this.textLodMode),this.selectedTextInstanceCount=0,this.orderedBatches?.setColorCommutationEnabled(!this.primitiveColors.has(`stroke`)&&!this.primitiveColors.has(`fill`)&&!this.primitiveColors.has(`text`)),this.orderedBatches?.invalidate(),this.destroyVectorMinifyResources(),this.needsVisibleSetUpdate=!0,this.requestFrame()}setVectorColorOverride(e,t,n,r){let i=Q(e,0,1),a=Q(t,0,1),o=Q(n,0,1),s=Q(r,0,1),c=this.vectorOverrideColor;Math.abs(c[0]-i)<=1e-6&&Math.abs(c[1]-a)<=1e-6&&Math.abs(c[2]-o)<=1e-6&&Math.abs(this.vectorOverrideOpacity-s)<=1e-6||(this.vectorOverrideColor=[i,a,o],this.vectorOverrideOpacity=s,this.orderedBatches?.setBlackDarkenSourceOverEnabled(s===0||i===0&&a===0&&o===0),this.requestFrame())}getVectorColorOverride(){return[...this.vectorOverrideColor,this.vectorOverrideOpacity]}setInteractionViewportProvider(e){this.interactionViewportProvider=e}beginPanInteraction(){this.hasCameraInteractionSinceSceneLoad=!0,this.syncCameraTargetsToCurrent(),this.panVelocityWorldX=0,this.panVelocityWorldY=0,this.lastPanVelocityUpdateTimeMs=0,this.lastPanFrameCameraX=this.cameraCenterX,this.lastPanFrameCameraY=this.cameraCenterY,this.lastPanFrameTimeMs=0,this.isPanInteracting=!0}endPanInteraction(){this.isPanInteracting=!1;let e=performance.now(),t=this.lastPanVelocityUpdateTimeMs>0&&e-this.lastPanVelocityUpdateTimeMs<=120?Math.hypot(this.panVelocityWorldX,this.panVelocityWorldY):0;Number.isFinite(t)&&t>=5?(this.targetCameraCenterX=this.cameraCenterX+this.panVelocityWorldX/24,this.targetCameraCenterY=this.cameraCenterY+this.panVelocityWorldY/24,this.lastCameraAnimationTimeMs=0):(this.targetCameraCenterX=this.cameraCenterX,this.targetCameraCenterY=this.cameraCenterY),this.panVelocityWorldX=0,this.panVelocityWorldY=0,this.lastPanVelocityUpdateTimeMs=0,this.lastPanFrameTimeMs=0,this.needsVisibleSetUpdate=!0,this.requestFrame()}resize(){if(!(`clientWidth`in this.canvas))return;let e=window.devicePixelRatio||1,t=Math.max(1,Math.floor(this.canvas.clientWidth*e)),n=Math.max(1,Math.floor(this.canvas.clientHeight*e));(this.canvas.width!==t||this.canvas.height!==n)&&(this.canvas.width=t,this.canvas.height=n,this.destroyVectorMinifyResources(),this.needsVisibleSetUpdate=!0,this.requestFrame())}getRasterLayerUpdates(){return this.rasterLayerUpdates}async prepareRasterLayerUpdatesAsync(e){return In(this.prepareRasterLayerUpdateSteps(e),(e,t)=>this.recordPerformanceTransition(e,t))}prepareRasterLayerUpdates(e){return Fn(this.prepareRasterLayerUpdateSteps(e))}*prepareRasterLayerUpdateSteps(e){e=new Map(e);let t=this.scene;if(!t||this.isDisposed)throw Error(`No active scene for raster replacement.`);En(t,e);let n=/* @__PURE__ */ new Map,r=!1,i=0,a=()=>{for(let e of n.values())this.deleteRasterLayerTextures(e);n.clear(),this.rasterStagedBytes=Math.max(0,(this.rasterStagedBytes??0)-i),i=0},o=!1,s=function*(){let r=[...e].filter(([e,n])=>(this.rasterLayerUpdates.get(e)??t.rasterLayers[e])!==n),s=new Set(r.map(([e])=>e)),c=(this.rasterLayers??[]).reduce((e,t,n)=>e+(s.has(n)?0:t.estimatedBytes??0),0),l=Dt(),u=this.rasterStagedBytes??0,d=Math.max(0,Math.min(l.bytes-c-u,l.peakBytes-this.estimatedRasterResidentBytes()-u)),f=ht((this.rasterCompression??=new Yt(this.gl)).capabilities)!==null,p=r.map(([,e])=>this.classifyRasterLayerSource(e,f));for(let e=0;e<3;e++){let e=this.planRasterLayerMemory(p,d);It(e,this);try{i=e.estimatedBytes,this.rasterStagedBytes=(this.rasterStagedBytes??0)+i;for(let[i,[a]]of r.entries()){let r=e.plans[i],o=e.compressionFormats[i],s=yield{source:p[i],plan:r,cached:_c(p[i],r)||gc(p[i],r,o)||(this.rasterResourceCache?.has(p[i],r,o)??!1)};if(this.scene!==t||this.isDisposed||!this.rasterTextureResidencyEnabled)throw new DOMException(`Raster update superseded.`,`AbortError`);let c=this.createRasterLayerGpu(p[i],a,r,o,s);n.set(a,c)}let a=[...n.values()].reduce((e,t)=>e+t.estimatedBytes,0);this.rasterStagedBytes+=a-i,i=a;break}catch(t){if(a(),!this.retryRasterCompression(e.compressionFormats,t))throw t}}o=!0};try{this.rasterTextureResidencyEnabled&&(yield*s.call(this))}catch(e){throw a(),e}return{commit:()=>{if(r||this.isDisposed||this.scene!==t)throw a(),r=!0,new DOMException(`Raster update superseded.`,`AbortError`);if(!this.rasterTextureResidencyEnabled)a();else if(!o)try{Fn(s.call(this))}catch(e){throw a(),r=!0,e}for(let[e,t]of n){let n=this.rasterLayers[e];n&&this.getRasterResourceCache().park(n,n.estimatedBytes??0),this.rasterLayers[e]=t}n.clear(),this.rasterStagedBytes=Math.max(0,(this.rasterStagedBytes??0)-i),i=0,this.destroyRasterStripBatches(),this.destroyRasterAtlasBatches();for(let[t,n]of e)this.rasterLayerUpdates.set(t,n);this.updateRasterTileSeams(t),this.rasterResolutionSources=null,this.rasterResolutionPlanner?.invalidate(),this.trimRasterResourceCache(),r=!0,this.destroyVectorMinifyResources(),this.requestFrame()},dispose:()=>{r||(r=!0,a())}}}getOptionalContentVisibility(){return this.optionalContentVisibility}pageRasterVisibility;recordPerformanceTransition(e,t){this.performanceProfiler?.recordTransition(e,t)}setPageRasterVisibility(e){this.pageRasterVisibility?.size===e.size&&[...e].every(e=>this.pageRasterVisibility.has(e))||(this.pageRasterVisibility=new Set(e),this.setOptionalContentVisibility({...this.optionalContentVisibility??L(this.scene),rasterPages:this.pageRasterVisibility}))}setOptionalContentVisibility(e){this.pageRasterVisibility&&e.rasterPages!==this.pageRasterVisibility&&(e={...e,rasterPages:this.pageRasterVisibility}),!(this.isDisposed||this.optionalContentVisibility===e)&&(this.optionalContentVisibility=e,this.scenePaintVisibility?.setVisibility(e),this.orderedBatches?.invalidate(),this.destroyVectorMinifyResources(),this.needsVisibleSetUpdate=!0,this.requestFrame())}setScene(e,t={}){let n=performance.now();if(this.isDisposed)throw Error(`Cannot upload a scene after the WebGL renderer has been disposed.`);this.fillCoverageMetadata=null,this.scene!==e&&(t.preserveRasterResolution?(this.rasterResolutionPlanner?.invalidate(),this.rasterResolutionView&&={...this.rasterResolutionView,width:this.canvas.width,height:this.canvas.height,cameraCenterX:this.cameraCenterX,cameraCenterY:this.cameraCenterY,zoom:this.zoom}):(this.rasterResolutionPlanner=new Yn,this.rasterResolutionView=null,this.rasterResolutionSources=null),t.preserveRasterResolution||this.performanceProfiler?.stop(),this.pageRasterVisibility=void 0,this.rasterLayerUpdates.clear(),this.paintCompositor?.dispose(),this.paintCompositor=null,this.optionalContentVisibility=L(e),this.primitiveColors=null,this.primitiveHighlights?.dispose(),this.primitiveHighlights=null),d(e),this.scenePaintVisibility=new $e(e),this.scenePaintVisibility.setVisibility(this.optionalContentVisibility),this.uploadVectorClips(e),this.scene=e,this.segmentCount=e.segmentCount,this.fillPathCount=e.fillPathCount,this.textInstanceCount=e.textInstanceCount,this.pageRects=Oc(e),this.pageBackgroundSourceRects=null,this.pageTextRanges=kc(e,this.pageRects,this.textInstanceCount),this.textLodRuntime?.dispose(),this.orderedTextLod=null;let r=performance.now(),i=this.thumbnailMode||this.scenePaintVisibility.requiresCompositing?null:this.textLodMode===`auto`?fo(e):uo(e);this.recordPerformanceTransition(`pageSwap.textLod`,performance.now()-r),this.textLodRuntime=i?new po(i,this.textLodMode):null,this.textLodGpuActive=!1,this.selectedTextInstanceCount=0,this.visiblePageRectIndices.length<Math.floor(this.pageRects.length/4)&&(this.visiblePageRectIndices=new Uint32Array(Math.floor(this.pageRects.length/4))),this.visiblePageRectCount=0,this.visibleTextRanges=[],this.thumbnailMode||this.buildSegmentBounds(e),this.isPanInteracting=!1,this.destroyVectorMinifyResources(),this.destroyVectorLodResources(),this.destroyRasterLayerTextures(!!t.preserveRasterResolution),this.rasterTextureResidencyEnabled&&this.uploadRasterLayers(e),this.uploadGradientPaintData(e);let a=this.uploadFillPaths(e),o=this.rebuildVectorLod(e);this.grid=!this.thumbnailMode&&!o&&!e.drawRuns&&this.segmentCount>0?oa(e):null;let s=null;if(this.textLodMode===`auto`&&i?.data){let t=i.data,n=this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE);Dc(t.combinedInstanceCount,n)&&Dc(e.textGlyphCount+1,n)&&Dc(e.textGlyphSegmentCount+4,n)&&t.combinedInstanceCount<=16777216?(s=t,this.textLodGpuActive=!0):this.textLodRuntime?.setResourceFallback(`resource-capacity`)}let c,l=performance.now();try{c=this.uploadTextData(e,s)}catch(t){if(!s)throw t;this.textLodRuntime?.setResourceFallback(`resource-capacity`),this.textLodGpuActive=!1,s=null,c=this.uploadTextData(e,null)}this.recordPerformanceTransition(`pageSwap.textUpload`,performance.now()-l),this.orderedTextLod=e.drawRuns&&s?new ta(e,s):null,this.orderedTextLod&&s&&this.orderedRunCuller?.includeTextLod(s),this.sceneStats={gridWidth:this.grid?.gridWidth??0,gridHeight:this.grid?.gridHeight??0,gridIndexCount:this.grid?.indices.length??0,maxCellPopulation:this.grid?.maxCellPopulation??0,fillPathTextureWidth:a.pathMetaTextureWidth,fillPathTextureHeight:a.pathMetaTextureHeight,fillSegmentTextureWidth:a.segmentTextureWidth,fillSegmentTextureHeight:a.segmentTextureHeight,textureWidth:this.segmentTextureWidth,textureHeight:this.segmentTextureHeight,maxTextureSize:this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE),textInstanceTextureWidth:c.instanceTextureWidth,textInstanceTextureHeight:c.instanceTextureHeight,textGlyphTextureWidth:c.glyphMetaTextureWidth,textGlyphTextureHeight:c.glyphMetaTextureHeight,textSegmentTextureWidth:c.glyphSegmentTextureWidth,textSegmentTextureHeight:c.glyphSegmentTextureHeight};let u=e.drawRuns?0:this.segmentCount,f=this.scenePaintVisibility.requiresCompositing?this.segmentCount:u;this.allSegmentIds=new Float32Array(f);for(let e=0;e<f;e+=1)this.allSegmentIds[e]=e;this.gl.bindBuffer(this.gl.ARRAY_BUFFER,this.allSegmentIdBuffer),this.gl.bufferData(this.gl.ARRAY_BUFFER,this.allSegmentIds,this.gl.STATIC_DRAW),e.drawRuns&&(this.gl.bindBuffer(this.gl.ARRAY_BUFFER,this.visibleSegmentIdBuffer),this.gl.bufferData(this.gl.ARRAY_BUFFER,0,this.gl.DYNAMIC_DRAW)),this.allFillPathIds=new Float32Array(this.fillPathCount);for(let e=0;e<this.fillPathCount;e+=1)this.allFillPathIds[e]=e;this.gl.bindBuffer(this.gl.ARRAY_BUFFER,this.allFillPathIdBuffer),this.gl.bufferData(this.gl.ARRAY_BUFFER,this.allFillPathIds,this.gl.STATIC_DRAW),this.allTextInstanceIds=new Float32Array(this.textInstanceCount);for(let e=0;e<this.textInstanceCount;e+=1)this.allTextInstanceIds[e]=e;return this.gl.bindBuffer(this.gl.ARRAY_BUFFER,this.allTextInstanceIdBuffer),this.gl.bufferData(this.gl.ARRAY_BUFFER,this.allTextInstanceIds,this.gl.STATIC_DRAW),(e.drawRuns||this.visibleSegmentIds.length<u)&&(this.visibleSegmentIds=new Float32Array(u)),(e.drawRuns||this.segmentMarks.length<u)&&(this.segmentMarks=new Uint32Array(u),this.markToken=1),this.visibleSegmentCount=this.segmentCount,this.usingAllSegments=!0,this.setAllPagesAndTextVisible(),this.minZoom=.01,this.maxZoom=8192,this.hasCameraInteractionSinceSceneLoad=!0,this.syncCameraTargetsToCurrent(),this.needsVisibleSetUpdate=!0,this.requestFrame(),this.primitiveColors&&this.setPrimitiveColorUpdates(this.primitiveColors.updates()),this.recordPerformanceTransition(`pageSwap.setScene`,performance.now()-n),this.sceneStats}getSceneStats(){return this.sceneStats}getViewState(){return{cameraCenterX:this.cameraCenterX,cameraCenterY:this.cameraCenterY,zoom:this.zoom}}getPresentedViewState(){return{cameraCenterX:this.presentedCameraCenterX,cameraCenterY:this.presentedCameraCenterY,zoom:this.presentedZoom}}getPresentedFrameSerial(){return this.presentedFrameSerial}setViewState(e,t={}){let n=Number(e.cameraCenterX),r=Number(e.cameraCenterY),i=Number(e.zoom);if(!Number.isFinite(n)||!Number.isFinite(r)||!Number.isFinite(i))return;let a=Q(i,this.minZoom,this.maxZoom);this.cameraCenterX=n,this.cameraCenterY=r,this.zoom=a,this.targetCameraCenterX=n,this.targetCameraCenterY=r,this.targetZoom=a,this.lastCameraAnimationTimeMs=0,this.hasZoomAnchor=!1,this.isPanInteracting=!1,this.presentedCameraCenterX=this.cameraCenterX,this.presentedCameraCenterY=this.cameraCenterY,this.presentedZoom=this.zoom,this.needsVisibleSetUpdate=!0,t.scheduleFrame!==!1&&this.requestFrame()}setSearchHighlights(e){if(this.isDisposed)return;let t=this.gl,n=So(e);if(!n){(this.highlightOthersCount!==0||this.highlightCurrentCount!==0)&&(this.highlightOthersCount=0,this.highlightCurrentCount=0,this.requestFrame());return}t.bindBuffer(t.ARRAY_BUFFER,this.highlightOthersBuffer),t.bufferData(t.ARRAY_BUFFER,n.otherRects,t.DYNAMIC_DRAW),n.currentCount>0&&(t.bindBuffer(t.ARRAY_BUFFER,this.highlightCurrentBuffer),t.bufferData(t.ARRAY_BUFFER,n.currentRects,t.DYNAMIC_DRAW)),t.bindBuffer(t.ARRAY_BUFFER,null),this.highlightOthersCount=n.otherCount,this.highlightCurrentCount=n.currentCount,this.requestFrame()}setTextSelectionHighlights(e){if(this.isDisposed)return;let t=e?Math.floor(e.length/4):0;if(!e||t===0){this.highlightSelectionCount!==0&&(this.highlightSelectionCount=0,this.requestFrame());return}let n=this.gl;n.bindBuffer(n.ARRAY_BUFFER,this.highlightSelectionBuffer),n.bufferData(n.ARRAY_BUFFER,e.subarray(0,t*4),n.DYNAMIC_DRAW),n.bindBuffer(n.ARRAY_BUFFER,null),this.highlightSelectionCount=t,this.requestFrame()}fitToBounds(e,t=64){let n=Math.max(e.maxX-e.minX,1e-4),r=Math.max(e.maxY-e.minY,1e-4),i=Math.max(1,this.canvas.width-t*2),a=Math.max(1,this.canvas.height-t*2),o=Q(Math.min(i/n,a/r),1e-8,this.maxZoom);this.minZoom=Math.min(this.minZoom,o);let s=(e.minX+e.maxX)*.5,c=(e.minY+e.maxY)*.5;this.zoom=o,this.cameraCenterX=s,this.cameraCenterY=c,this.targetZoom=o,this.targetCameraCenterX=s,this.targetCameraCenterY=c,this.lastCameraAnimationTimeMs=0,this.hasZoomAnchor=!1,this.isPanInteracting=!1,this.presentedCameraCenterX=this.cameraCenterX,this.presentedCameraCenterY=this.cameraCenterY,this.presentedZoom=this.zoom,this.needsVisibleSetUpdate=!0,this.requestFrame()}dispose(){if(this.paintCompositor?.dispose(),this.paintCompositor=null,this.fillCoverageMetadata=null,this.paintShapeUniforms.clear(),this.isDisposed)return;this.isDisposed=!0,this.performanceProfiler?.dispose(),this.primitiveHighlights?.dispose(),this.primitiveHighlights=null,this.primitiveColors=null,this.orderedRunCuller=null,this.scenePaintVisibility=null,this.rafHandle!==0&&(cancelAnimationFrame(this.rafHandle),this.rafHandle=0),this.externalFrameDriver=!0,this.frameListener=null,this.interactionViewportProvider=null,this.destroyVectorMinifyResources(),this.destroyVectorLodResources();let e=this.gl;this.destroyRasterLayerTextures(),this.rasterLayers=[],this.rasterCompression?.dispose(),this.rasterCompression=null;let t=[this.segmentTextureA,this.segmentTextureB,this.segmentTextureC,this.segmentTextureD,this.fillPathMetaTextureA,this.fillPathMetaTextureB,this.fillPathMetaTextureC,this.fillSegmentTextureA,this.fillSegmentTextureB,this.textInstanceTextureA,this.textInstanceTextureB,this.textInstanceTextureC,this.textGlyphMetaTextureA,this.textGlyphMetaTextureB,this.textGlyphRasterMetaTexture,this.textGlyphSegmentTextureA,this.textGlyphSegmentTextureB,this.textRasterAtlasTexture,this.pageBackgroundTexture,...this.gradientMetaTextures,this.gradientLutTexture,...this.gradientFillTextures,...this.gradientStrokeTextures];for(let n of t)e.deleteTexture(n);e.deleteTexture(this.paintFoldNeutralTexture),this.paintFoldNeutralTexture=null,e.deleteBuffer(this.orderedInstanceBuffer),this.orderedInstanceBuffer=null,this.destroyMixedVectorResources(),this.orderedBatches=null,this.runLookup=null,e.deleteTexture(this.vectorClipTexture),this.vectorClipTexture=null,e.deleteTexture(this.vectorClipBoundsTexture),this.vectorClipBoundsTexture=null,this.vectorClipHeaders=null,this.vectorClipUniforms.clear();let n=[this.cornerBuffer,this.pageBackgroundBuffer,this.allSegmentIdBuffer,this.visibleSegmentIdBuffer,this.allFillPathIdBuffer,this.allTextInstanceIdBuffer,this.selectedTextInstanceIdBuffer,this.highlightOthersBuffer,this.highlightCurrentBuffer,this.highlightSelectionBuffer];for(let t of n)e.deleteBuffer(t);let r=[this.segmentVao,this.fillVao,this.gradientPaintVao,this.textVao,this.blitVao,this.pageBackgroundVao,this.highlightOthersVao,this.highlightCurrentVao,this.highlightSelectionVao];for(let t of r)e.deleteVertexArray(t);let i=[this.segmentProgram,this.fillProgram,this.gradientFillProgram,this.gradientStrokeProgram,this.textProgram,this.vectorCompositeProgram,this.rasterProgram,this.pageBackgroundProgram,this.highlightProgram];for(let t of i)e.deleteProgram(t);this.rasterStripProgram&&e.deleteProgram(this.rasterStripProgram.program),this.rasterStripProgram=null,this.rasterAtlasProgram&&e.deleteProgram(this.rasterAtlasProgram.program),this.rasterAtlasProgram=null,this.rasterRepeatProgram&&e.deleteProgram(this.rasterRepeatProgram.program),this.rasterRepeatProgram=null,this.rasterTextureBatch&&(e.deleteProgram(this.rasterTextureBatch.program),e.deleteBuffer(this.rasterTextureBatch.buffer),e.deleteVertexArray(this.rasterTextureBatch.vao)),this.rasterTextureBatch=null,this.destroyRasterTextureBatchCache(),e.bindVertexArray(null),e.bindBuffer(e.ARRAY_BUFFER,null),e.bindBuffer(e.ELEMENT_ARRAY_BUFFER,null),e.bindFramebuffer(e.FRAMEBUFFER,null),e.useProgram(null);for(let t=0;t<=15;t+=1)e.activeTexture(e.TEXTURE0+t),e.bindTexture(e.TEXTURE_2D,null);e.activeTexture(e.TEXTURE0),this.scene=null,this.grid=null,this.sceneStats=null,this.pageRects=/* @__PURE__ */ new Float32Array,this.pageBackgroundSourceRects=null,this.pageBackgroundPageIndices=/* @__PURE__ */ new Uint32Array,this.pageBackgroundInstanceRects=/* @__PURE__ */ new Float32Array,this.pageBackgroundInstanceCount=0,this.pageTextRanges=/* @__PURE__ */ new Uint32Array,this.visiblePageRectIndices=/* @__PURE__ */ new Uint32Array,this.visibleTextRanges=[],this.textLodRuntime?.dispose(),this.textLodRuntime=null,this.orderedTextLod=null,this.textLodGpuActive=!1,this.selectedTextInstanceIds=/* @__PURE__ */ new Float32Array,this.selectedTextInstanceCount=0,this.gradientData=null,e.deleteBuffer(this.gradientMeshBuffer),e.deleteVertexArray(this.gradientMeshVao),e.deleteProgram(this.gradientMeshProgram),this.gradientMeshBuffer=null,this.gradientMeshVao=null,this.gradientMeshProgram=null,this.gradientMeshRanges=/* @__PURE__ */ new Uint32Array,this.orderedGradientPaintCommands=[]}panByPixels(e,t){if(!Number.isFinite(e)||!Number.isFinite(t))return;this.hasCameraInteractionSinceSceneLoad=!0,this.hasZoomAnchor=!1;let n=this.resolveClientToPixelScale(),r=-(e*n.x)/this.zoom,i=t*n.y/this.zoom;this.cameraCenterX+=r,this.cameraCenterY+=i,this.targetCameraCenterX=this.cameraCenterX,this.targetCameraCenterY=this.cameraCenterY,this.needsVisibleSetUpdate=!0,this.requestFrame()}zoomAtClientPoint(e,t,n){let r=Q(n,.1,10);this.hasCameraInteractionSinceSceneLoad=!0;let i=this.clientToWorld(e,t),a=Q(this.targetZoom*r,this.minZoom,this.maxZoom);this.hasZoomAnchor=!0,this.zoomAnchorClientX=e,this.zoomAnchorClientY=t,this.zoomAnchorWorldX=i.x,this.zoomAnchorWorldY=i.y,this.targetZoom=a;let o=this.computeCameraCenterForAnchor(this.zoomAnchorClientX,this.zoomAnchorClientY,this.zoomAnchorWorldX,this.zoomAnchorWorldY,a);this.targetCameraCenterX=o.x,this.targetCameraCenterY=o.y,this.needsVisibleSetUpdate=!0,this.panVelocityWorldX=0,this.panVelocityWorldY=0,this.lastPanVelocityUpdateTimeMs=0,this.lastPanFrameTimeMs=0,this.requestFrame()}requestFrame(){this.externalFrameDriver||this.rafHandle===0&&(this.rafHandle=requestAnimationFrame(e=>{this.rafHandle=0,this.render(e)}))}render(e=performance.now()){this.frameDrawCalls=0;let t=this.performanceProfiler?.enabled?this.performanceProfiler:null;t?.beginFrame(e);try{this.renderFrame(e,t)}finally{t?.endFrame()}}renderFrame(e,t){t?.beginSection(`cameraAndState`);let n=this.updateCameraWithDamping(e);this.updatePanReleaseVelocitySample(e);let r=this.gl;if(this.ensureRenderState(),this.updateRasterResolution(),t?.endSection(`cameraAndState`),t?.setFrameContext({cameraCenterX:this.cameraCenterX,cameraCenterY:this.cameraCenterY,zoom:this.zoom,viewportWidth:this.canvas.width,viewportHeight:this.canvas.height,unitsPerPixel:this.localToClipRenderingEnabled?null:1/Math.max(this.zoom,1e-6)}),!this.scene||this.fillPathCount===0&&this.segmentCount===0&&this.textInstanceCount===0&&(this.gradientData?.gradientFillPathCount??0)===0&&(this.gradientData?.gradientStrokeRunCount??0)===0&&this.rasterLayers.length===0&&this.pageRects.length===0){r.bindFramebuffer(r.FRAMEBUFFER,null),r.viewport(0,0,this.canvas.width,this.canvas.height),r.clearColor(pc,mc,hc,1),r.clear(r.COLOR_BUFFER_BIT),this.capturePresentedFrameState(),this.emitFrameStats({renderedSegments:0,totalSegments:0,usedCulling:!1,zoom:this.zoom}),n&&this.requestFrame();return}t?.add(`directFrames`);let i=this.renderDirectToScreen();t?.beginSection(`overlays`),this.drawSearchHighlights(this.canvas.width,this.canvas.height,this.cameraCenterX,this.cameraCenterY),t?.endSection(`overlays`),this.capturePresentedFrameState(),this.emitFrameStats(i),(n||this.scene?.pendingPagePreviews&&this.rasterRenderingEnabled&&this.pageBackgroundColor[3]>0&&Qn()&&er(this.scene,{...this.getViewState(),width:this.canvas.width,height:this.canvas.height}))&&this.requestFrame()}capturePresentedFrameState(){this.presentedCameraCenterX=this.cameraCenterX,this.presentedCameraCenterY=this.cameraCenterY,this.presentedZoom=this.zoom,this.presentedFrameSerial+=1}isTextHeavyStrokeFreeScene(){return na(this.textInstanceCount,this.segmentCount)}renderDirectToScreen(){let e=this.performanceProfiler?.enabled?this.performanceProfiler:null,t=this.gl,n=this.shouldUseVectorMinifyPath()&&this.ensureVectorMinifyResources();if(n&&this.vectorMinifyWarmupPending&&(n=!1,this.vectorMinifyWarmupPending=!1,this.needsVisibleSetUpdate=!0,this.requestFrame()),t.bindFramebuffer(t.FRAMEBUFFER,null),t.viewport(0,0,this.canvas.width,this.canvas.height),t.clearColor(pc,mc,hc,1),t.clear(t.COLOR_BUFFER_BIT),this.needsVisibleSetUpdate){if(e?.beginSection(`visibleSelection`),n){let e=this.computeVectorMinifyZoom(this.vectorMinifyWidth,this.vectorMinifyHeight);this.updateVisibleSet(this.cameraCenterX,this.cameraCenterY,this.vectorMinifyWidth,this.vectorMinifyHeight,e)}else this.updateVisibleSet(this.cameraCenterX,this.cameraCenterY,this.canvas.width,this.canvas.height,this.zoom);this.needsVisibleSetUpdate=!1,e?.endSection(`visibleSelection`)}let r=0;if(this.scene?.drawRuns)r=this.drawSourceOrderedContent(this.canvas.width,this.canvas.height,this.cameraCenterX,this.cameraCenterY,this.zoom);else if(n){let e=this.getOrderedGradientMinifyPlan();e.splitOrderedGradientPrefix?this.drawOrderedGradientPaint(this.canvas.width,this.canvas.height,this.cameraCenterX,this.cameraCenterY):this.rasterRenderingEnabled&&this.drawRasterLayer(this.canvas.width,this.canvas.height,this.cameraCenterX,this.cameraCenterY),r=this.renderVectorLayerIntoMinifyTarget(this.vectorMinifyWidth,this.vectorMinifyHeight,this.cameraCenterX,this.cameraCenterY,e.includeGradientPaint),this.compositeVectorMinifyLayer()}else this.drawOrderedGradientPaint(this.canvas.width,this.canvas.height,this.cameraCenterX,this.cameraCenterY),this.fillRenderingEnabled&&this.drawFilledPaths(this.canvas.width,this.canvas.height,this.cameraCenterX,this.cameraCenterY),this.strokeRenderingEnabled&&(r=this.drawVisibleSegments(this.canvas.width,this.canvas.height,this.cameraCenterX,this.cameraCenterY)),this.textRenderingEnabled&&this.drawTextInstances(this.canvas.width,this.canvas.height,this.cameraCenterX,this.cameraCenterY);return{renderedSegments:r,totalSegments:this.segmentCount,redundantSegments:this.getRedundantSegmentCount(),paintOrderApproximated:this.isPaintOrderApproximated(),usedCulling:this.scene?.drawRuns?this.orderedRunsCulled:!this.usingAllSegments,zoom:this.zoom}}getRedundantSegmentCount(){return this.strokeRenderingEnabled?this.orderedBatches?.culledSegmentCount??0:0}isPaintOrderApproximated(){return this.orderedBatches?.paintOrderApproximated??!1}hasOrdinaryVectorContent(){return this.fillRenderingEnabled&&this.fillPathCount>0||this.strokeRenderingEnabled&&this.segmentCount>0||this.textRenderingEnabled&&this.textInstanceCount>0}hasVectorContent(){return this.hasOrdinaryVectorContent()||this.fillRenderingEnabled&&(this.gradientData?.gradientFillPathCount??0)>0||this.strokeRenderingEnabled&&(this.gradientData?.gradientStrokeRunCount??0)>0}shouldUseVectorMinifyPath(){return this.scene?.drawRuns,!1}getOrderedGradientMinifyPlan(){return b(this.rasterRenderingEnabled,this.gradientPaintRequiresDirectRendering,this.hasOrdinaryVectorContent(),this.hasVectorContent())}computeVectorMinifyZoom(e,t){let n=Math.min(e/Math.max(1,this.canvas.width),t/Math.max(1,this.canvas.height));return this.zoom*Math.max(1,n)}ensureVectorMinifyResources(){let e=this.gl,t=e.getParameter(e.MAX_TEXTURE_SIZE),n=t/Math.max(1,this.canvas.width),r=t/Math.max(1,this.canvas.height),i=Math.max(1,Math.min(2,n,r)),a=Math.max(this.canvas.width,Math.floor(this.canvas.width*i)),o=Math.max(this.canvas.height,Math.floor(this.canvas.height*i));if(a<this.canvas.width||o<this.canvas.height)return!1;if(this.vectorMinifyTexture&&this.vectorMinifyFramebuffer&&this.vectorMinifyWidth===a&&this.vectorMinifyHeight===o)return!0;this.destroyVectorMinifyResources();let s=e.createTexture();if(!s)return!1;e.bindTexture(e.TEXTURE_2D,s),Cc(e),e.texStorage2D(e.TEXTURE_2D,1,e.RGBA8,a,o);let c=e.createFramebuffer();if(!c)return e.deleteTexture(s),!1;e.bindFramebuffer(e.FRAMEBUFFER,c),e.framebufferTexture2D(e.FRAMEBUFFER,e.COLOR_ATTACHMENT0,e.TEXTURE_2D,s,0);let l=e.checkFramebufferStatus(e.FRAMEBUFFER);return e.bindFramebuffer(e.FRAMEBUFFER,null),l===e.FRAMEBUFFER_COMPLETE?(this.vectorMinifyTexture=s,this.vectorMinifyFramebuffer=c,this.vectorMinifyWidth=a,this.vectorMinifyHeight=o,this.vectorMinifyWarmupPending=!0,!0):(e.deleteFramebuffer(c),e.deleteTexture(s),!1)}renderVectorLayerIntoMinifyTarget(e,t,n,r,i){if(!this.vectorMinifyFramebuffer||!this.vectorMinifyTexture)return 0;let a=this.gl,o=this.computeVectorMinifyZoom(e,t);a.bindFramebuffer(a.FRAMEBUFFER,this.vectorMinifyFramebuffer),a.viewport(0,0,e,t),a.clearColor(0,0,0,0),a.clear(a.COLOR_BUFFER_BIT),a.blendFuncSeparate(a.SRC_ALPHA,a.ONE_MINUS_SRC_ALPHA,a.ONE,a.ONE_MINUS_SRC_ALPHA),i&&this.drawOrderedGradientVectors(e,t,n,r,o),this.fillRenderingEnabled&&this.drawFilledPaths(e,t,n,r,o);let s=this.strokeRenderingEnabled?this.drawVisibleSegments(e,t,n,r,o):0;return this.textRenderingEnabled&&this.drawTextInstances(e,t,n,r,o,{viewportWidth:this.canvas.width,viewportHeight:this.canvas.height,cameraCenterX:n,cameraCenterY:r,zoom:this.zoom}),a.bindTexture(a.TEXTURE_2D,this.vectorMinifyTexture),a.bindFramebuffer(a.FRAMEBUFFER,null),s}compositeVectorMinifyLayer(){if(!this.vectorMinifyTexture)return;let e=this.gl;e.bindFramebuffer(e.FRAMEBUFFER,null),e.viewport(0,0,this.canvas.width,this.canvas.height),e.useProgram(this.vectorCompositeProgram),e.bindVertexArray(this.blitVao),e.activeTexture(e.TEXTURE0),e.bindTexture(e.TEXTURE_2D,this.vectorMinifyTexture),e.uniform1i(this.uVectorLayerTex,0),e.uniform2f(this.uVectorLayerViewportPx,this.canvas.width,this.canvas.height),e.blendFuncSeparate(e.ONE,e.ONE_MINUS_SRC_ALPHA,e.ONE,e.ONE_MINUS_SRC_ALPHA),e.drawArrays(e.TRIANGLE_STRIP,0,4),this.frameDrawCalls++,e.blendFuncSeparate(e.SRC_ALPHA,e.ONE_MINUS_SRC_ALPHA,e.ONE,e.ONE_MINUS_SRC_ALPHA)}drawOrderedGradientPaint(e,t,n,r,i=this.zoom){this.rasterRenderingEnabled&&this.drawPageBackgrounds(e,t,n,r,i);let a=!1;for(let o of this.orderedGradientPaintCommands)o.kind===`raster`?this.rasterRenderingEnabled&&(a||=(this.prepareRasterProgram(e,t,n,r,i),this.gl.blendFuncSeparate(this.gl.ONE,this.gl.ONE_MINUS_SRC_ALPHA,this.gl.ONE,this.gl.ONE_MINUS_SRC_ALPHA),!0),this.drawRasterLayerAtIndex(o.index,e,t,n,r,i,!0)):o.kind===`gradient-fill`?(a&&=(this.gl.blendFuncSeparate(this.gl.SRC_ALPHA,this.gl.ONE_MINUS_SRC_ALPHA,this.gl.ONE,this.gl.ONE_MINUS_SRC_ALPHA),!1),this.fillRenderingEnabled&&this.drawGradientFillPath(o.index,e,t,n,r,i)):this.strokeRenderingEnabled?(a&&=(this.gl.blendFuncSeparate(this.gl.SRC_ALPHA,this.gl.ONE_MINUS_SRC_ALPHA,this.gl.ONE,this.gl.ONE_MINUS_SRC_ALPHA),!1),this.drawGradientStrokeRun(o.index,e,t,n,r,i)):a&&=(this.gl.blendFuncSeparate(this.gl.SRC_ALPHA,this.gl.ONE_MINUS_SRC_ALPHA,this.gl.ONE,this.gl.ONE_MINUS_SRC_ALPHA),!1);a&&this.gl.blendFuncSeparate(this.gl.SRC_ALPHA,this.gl.ONE_MINUS_SRC_ALPHA,this.gl.ONE,this.gl.ONE_MINUS_SRC_ALPHA)}drawOrderedGradientVectors(e,t,n,r,i){for(let a of this.orderedGradientPaintCommands)a.kind===`gradient-fill`&&this.fillRenderingEnabled?this.drawGradientFillPath(a.index,e,t,n,r,i):a.kind===`gradient-stroke`&&this.strokeRenderingEnabled&&this.drawGradientStrokeRun(a.index,e,t,n,r,i)}drawGradientFillPath(e,t,n,r,i,a){let o=this.gradientData;if(!o||e<0||e>=o.gradientFillPathCount)return;let s=this.gl,c=this.gradientMeshRanges?.[e*2+1]??0,l=this.performanceProfiler?.enabled?this.performanceProfiler:null;l?.beginSection(`gradientFillSubmission`);let u=c?this.gradientMeshProgram:this.gradientFillProgram,d=c?this.gradientMeshUniforms:this.gradientFillUniforms;s.blendFuncSeparate(s.SRC_ALPHA,s.ONE_MINUS_SRC_ALPHA,s.ONE,s.ONE_MINUS_SRC_ALPHA),s.useProgram(u),this.bindVectorClip(u),c||this.bindPaintFold(u),s.bindVertexArray(c?this.gradientMeshVao:this.gradientPaintVao);for(let e=0;e<this.gradientFillTextures.length;e+=1)this.bindOrderedTexture(e,this.gradientFillTextures[e]);for(let e=0;e<this.gradientMetaTextures.length;e+=1)this.bindOrderedTexture(6+e,this.gradientMetaTextures[e]);this.bindOrderedTexture(11,this.gradientLutTexture),this.prepareOrderedProgram(u)&&(s.uniform1i(d.uPathMetaTexA,0),s.uniform1i(d.uPathMetaTexB,1),s.uniform1i(d.uPathMetaTexC,2),s.uniform1i(d.uPaintMetaTex,3),s.uniform1i(d.uSegmentTexA,4),s.uniform1i(d.uSegmentTexB,5),this.setGradientUniforms(d,6,11),s.uniform2i(d.uPathMetaTexSize,this.gradientFillPathTextureWidth,this.gradientFillPathTextureHeight),s.uniform2i(d.uSegmentTexSize,this.gradientFillSegmentTextureWidth,this.gradientFillSegmentTextureHeight),s.uniform1i(d.uBandBase,this.gradientFillBandBase),s.uniform1i(d.uBandEntries,this.gradientFillBandEntries),s.uniform1i(d.uCellHeaders,this.gradientFillCellBase+1),this.setGradientViewUniforms(d,t,n,r,i,a),s.uniform1f(d.uAAScreenPx,1),s.uniform4f(d.uVectorOverride,this.vectorOverrideColor[0],this.vectorOverrideColor[1],this.vectorOverrideColor[2],this.vectorOverrideOpacity));let f=this.primitiveColors?.gradient(`gradient-fill`,e);s.uniform4f(d.uPrimitiveOverride,f?.[0]??0,f?.[1]??0,f?.[2]??0,+!!f);let p=this.gradientClipBounds();if(s.uniform4f(d.uClipBounds,p[0],p[1],p[2],p[3]),this.lastGradientFillDrawIndex=e,c?(s.uniform1i(d.uMeshPathIndex,e),s.drawArrays(s.TRIANGLES,this.gradientMeshRanges[e*2],c)):s.drawArraysInstanced(s.TRIANGLE_STRIP,e*4,4,1),this.frameDrawCalls++,l?.endSection(`gradientFillSubmission`),l){let s=e*4,u=Math.max(0,Math.trunc(o.gradientFillPathMetaA[s+1]??0)),d=this.countGradientClipPolygonEdges(l,`gradientFillIndexedClipNodes`);if(l.add(`gradientFillClipPolygonEdges`,d),c)l.add(`gradientMeshFillDraws`),l.add(`gradientMeshFillSegments`,u),l.add(`gradientMeshTriangles`,c/3);else if(l.add(`gradientAnalyticFillDraws`),l.add(`gradientAnalyticFillSegments`,u),l.geometryDiagnostics&&!this.localToClipRenderingEnabled){let e=Math.max(0,Math.floor((o.gradientFillPathMetaA[s+2]-r)*a+t/2)),c=Math.max(0,Math.floor((o.gradientFillPathMetaA[s+3]-i)*a+n/2)),u=Math.min(t,Math.ceil((o.gradientFillPathMetaB[s]-r)*a+t/2)),f=Math.min(n,Math.ceil((o.gradientFillPathMetaB[s+1]-i)*a+n/2)),p=Math.max(0,u-e)*Math.max(0,f-c);l.add(`gradientAnalyticFillBBoxPixelsEstimate`,p),l.add(`gradientAnalyticFillClipEdgeTestsEstimate`,p*d);let m=this.gradientClipBounds(),h=1/Math.max(a,1e-6),g=[Math.max(o.gradientFillPathMetaA[s+2],m[0])-h,Math.max(o.gradientFillPathMetaA[s+3],m[1])-h],_=[Math.min(o.gradientFillPathMetaB[s],m[2])+h,Math.min(o.gradientFillPathMetaB[s+1],m[3])+h],v=Math.max(0,Math.floor((g[0]-r)*a+t/2)),y=Math.max(0,Math.floor((g[1]-i)*a+n/2)),b=Math.min(t,Math.ceil((_[0]-r)*a+t/2)),x=Math.min(n,Math.ceil((_[1]-i)*a+n/2)),S=g[0]>_[0]||g[1]>_[1];l.add(`gradientAnalyticFillQuadPixelsEstimate`,S?0:Math.max(0,b-v)*Math.max(0,x-y))}}}gradientClipBounds(){let e=this.vectorClipIndex,t=this.vectorClipBounds;return e<0||this.localToClipRenderingEnabled||!t||e*4+3>=t.length?_:t.subarray(e*4,e*4+4)}drawGradientStrokeRun(e,t,n,r,i,a){let o=this.gradientData;if(!o||e<0||e>=o.gradientStrokeRunCount)return;let s=Math.max(0,Math.trunc(o.gradientStrokeRunMetaA[e*4+1]??0));if(s===0)return;let c=this.gl,l=this.gradientStrokeUniforms,u=this.performanceProfiler?.enabled?this.performanceProfiler:null;u?.beginSection(`gradientStrokeSubmission`),c.blendFuncSeparate(c.SRC_ALPHA,c.ONE_MINUS_SRC_ALPHA,c.ONE,c.ONE_MINUS_SRC_ALPHA),c.useProgram(this.gradientStrokeProgram),this.bindVectorClip(this.gradientStrokeProgram),c.bindVertexArray(this.gradientPaintVao);for(let e=0;e<this.gradientStrokeTextures.length;e+=1)this.bindOrderedTexture(e,this.gradientStrokeTextures[e]);for(let e=0;e<this.gradientMetaTextures.length;e+=1)this.bindOrderedTexture(5+e,this.gradientMetaTextures[e]);this.bindOrderedTexture(10,this.gradientLutTexture),c.uniform1i(l.uRunMetaTexA,0),c.uniform1i(l.uEndpointsTex,1),c.uniform1i(l.uPrimitiveMetaTex,2),c.uniform1i(l.uPrimitiveBoundsTex,3),c.uniform1i(l.uStylesTex,4),this.setGradientUniforms(l,5,10),c.uniform2i(l.uRunMetaTexSize,this.gradientStrokeRunTextureWidth,this.gradientStrokeRunTextureHeight),c.uniform2i(l.uSegmentTexSize,this.gradientStrokeSegmentTextureWidth,this.gradientStrokeSegmentTextureHeight),this.setGradientViewUniforms(l,t,n,r,i,a),c.uniform1f(l.uAAScreenPx,.9),c.uniform1f(l.uLocalUnitsPerPixel,this.localToClipRenderingEnabled?this.localUnitsPerPixel:1/Math.max(a,1e-6)),c.uniform1f(l.uStrokeCurveEnabled,+!!this.strokeCurveEnabled),c.uniform4f(l.uVectorOverride,this.vectorOverrideColor[0],this.vectorOverrideColor[1],this.vectorOverrideColor[2],this.vectorOverrideOpacity);let d=this.primitiveColors?.gradient(`gradient-stroke`,e);c.uniform4f(l.uPrimitiveOverride,d?.[0]??0,d?.[1]??0,d?.[2]??0,+!!d),c.drawArraysInstanced(c.TRIANGLE_STRIP,e*4,4,s),this.frameDrawCalls++,u?.endSection(`gradientStrokeSubmission`),u?.add(`gradientStrokeDraws`),u?.add(`gradientStrokeSegments`,s),u&&u.add(`gradientStrokeClipPolygonEdges`,this.countGradientClipPolygonEdges(u,`gradientStrokeIndexedClipNodes`))}countGradientClipPolygonEdges(e,t){let n=this.vectorClipHeaders;if(!n)return 0;let r=this.vectorClipIndex,i=0,a=0;for(let e=0;e<n.length/4&&r>=0&&r*4<n.length;e++){let e=Math.max(0,n[r*4+2]);i+=e,e>0&&n[r*4+3]>=2&&a++,r=n[r*4]}return e.add(t,a),i}setGradientUniforms(e,t,n){let r=this.gl;r.uniform1i(e.uGradientMetaTexA,t),r.uniform1i(e.uGradientMetaTexB,t+1),r.uniform1i(e.uGradientMetaTexC,t+2),r.uniform1i(e.uGradientMetaTexD,t+3),r.uniform1i(e.uGradientMetaTexE,t+4),r.uniform1i(e.uGradientLutTex,n),r.uniform2i(e.uGradientMetaTexSize,this.gradientTextureWidth,this.gradientTextureHeight),r.uniform1i(e.uGradientCount,this.gradientData?.gradientCount??0)}setGradientViewUniforms(e,t,n,r,i,a){let o=this.gl;o.uniform2f(e.uViewport,t,n),o.uniform2f(e.uCameraCenter,r,i),o.uniform1f(e.uZoom,a),o.uniform1f(e.uUseLocalToClip,+!!this.localToClipRenderingEnabled),this.localToClipRenderingEnabled&&o.uniformMatrix4fv(e.uLocalToClip,!1,this.localToClipMatrix)}prepareRasterProgram(e,t,n,r,i){let a=this.gl;a.useProgram(this.rasterProgram),this.bindVectorClip(this.rasterProgram),this.bindPaintFold(this.rasterProgram),a.bindVertexArray(this.blitVao),this.prepareOrderedProgram(this.rasterProgram)&&(a.uniform1i(this.uRasterTex,12),a.uniform1i(this.uRasterMonoMips,13),a.uniform2f(this.uRasterViewport,e,t),a.uniform2f(this.uRasterCameraCenter,n,r),a.uniform1f(this.uRasterZoom,i),a.uniform1f(this.uRasterUseLocalToClip,+!!this.localToClipRenderingEnabled),this.localToClipRenderingEnabled&&a.uniformMatrix4fv(this.uRasterLocalToClip,!1,this.localToClipMatrix))}drawPageBackgrounds(e,t,n,r,i){if(this.pageRects.length===0||this.visiblePageRectCount===0)return;let a=this.gl;this.updatePageBackgroundInstances();let o=this.pageBackgroundProgram,s=this.pageBackgroundUniforms;a.useProgram(o),this.bindVectorClip(o),this.bindPaintFold(o),a.bindVertexArray(this.pageBackgroundVao),this.bindOrderedTexture(12,this.pageBackgroundTexture),this.setGradientViewUniforms(s,e,t,n,r,i),a.uniform1i(s.uRasterTex,12),a.uniform1f(s.uRasterOpacity,1),a.uniform1f(s.uPagePlaceholderTime,$n()),a.drawArraysInstanced(a.TRIANGLE_STRIP,0,4,this.visiblePageRectCount),this.frameDrawCalls++,this.performanceProfiler?.enabled&&(this.performanceProfiler.add(`pageBackgroundBatches`),this.performanceProfiler.add(`pageBackgroundInstances`,this.visiblePageRectCount))}updatePageBackgroundInstances(){let e=this.visiblePageRectCount,t=this.visiblePageRectIndices,n=this.pageBackgroundSourceRects!==this.pageRects||this.pageBackgroundInstanceCount!==e;for(let r=0;!n&&r<e;r++)n=this.pageBackgroundPageIndices[r]!==t[r];if(!n)return;this.pageBackgroundPageIndices.length<e&&(this.pageBackgroundPageIndices=new Uint32Array(e),this.pageBackgroundInstanceRects=new Float32Array(e*5));let r=this.pageBackgroundInstanceRects;for(let n=0;n<e;n++){let e=t[n]*4,i=n*5;this.pageBackgroundPageIndices[n]=t[n],r[i]=this.pageRects[e],r[i+1]=this.pageRects[e+1],r[i+2]=Math.max(this.pageRects[e+2]-this.pageRects[e],1e-6),r[i+3]=Math.max(this.pageRects[e+3]-this.pageRects[e+1],1e-6),r[i+4]=+!!this.scene?.pendingPagePreviews?.[t[n]]}this.gl.bindBuffer(this.gl.ARRAY_BUFFER,this.pageBackgroundBuffer),this.gl.bufferData(this.gl.ARRAY_BUFFER,r.subarray(0,e*5),this.gl.DYNAMIC_DRAW),this.pageBackgroundSourceRects=this.pageRects,this.pageBackgroundInstanceCount=e}setMultiplyBlend(){let e=this.gl;this.multiplyPass===0?e.blendFuncSeparate(e.DST_COLOR,e.ONE_MINUS_SRC_ALPHA,e.ZERO,e.ONE):e.blendFuncSeparate(e.ONE_MINUS_DST_ALPHA,e.ONE,e.ONE,e.ONE_MINUS_SRC_ALPHA)}drawRasterLayerAtIndex(e,t,n,r,i,a,o=!1){let s=this.rasterLayers[e];if(!s)return;if(s.repeat){this.drawRasterRepeatLayer(s,t,n,r,i,a),o&&this.prepareRasterProgram(t,n,r,i,a);return}let c=this.gl;o||(this.prepareRasterProgram(t,n,r,i,a),this.multiplyPass==null?c.blendFuncSeparate(c.ONE,c.ONE_MINUS_SRC_ALPHA,c.ONE,c.ONE_MINUS_SRC_ALPHA):this.setMultiplyBlend()),c.uniform1f(this.uRasterOpacity,s.opacity),c.uniform4f(this.uRasterMatrixABCD,s.matrix[0],s.matrix[1],s.matrix[2],s.matrix[3]),c.uniform2f(this.uRasterMatrixEF,s.matrix[4],s.matrix[5]);let l=!s.quad&&!s.uv&&!s.extraTiles?.length?this.rasterTileSeams?.get(e):void 0;c.uniform4fv(this.uRasterSeamBounds,l?.bounds??yc),c.uniform4fv(this.uRasterSeamGaps,l?.gaps??yc),c.uniform2f(this.uRasterSeamMaxFootprint,l?.maxFootprint[0]??0,l?.maxFootprint[1]??0),this.drawRasterTile(s);for(let e of s.extraTiles??[])this.drawRasterTile(e);!o&&this.multiplyPass==null&&c.blendFuncSeparate(c.SRC_ALPHA,c.ONE_MINUS_SRC_ALPHA,c.ONE,c.ONE_MINUS_SRC_ALPHA)}drawRasterTile(e,t,n){let r=this.gl;if(this.bindOrderedTexture(12,e.texture),this.bindOrderedTexture(13,e.monochrome?.mipTexture??e.texture),r.uniform1f(n?.uRasterMonochrome??this.uRasterMonochrome,e.monochrome?e.interpolate===!1?e.monochrome.coverage?5:4:e.monochrome.compact?3:e.monochrome.coverage?2:1:0),r.uniform1f(n?.uRasterOpaque??this.uRasterOpaque,+!!e.compressionFormat),e.monochrome&&(r.uniform2f(n?.uRasterMonoSize??this.uRasterMonoSize,e.monochrome.width,e.monochrome.height),r.uniform4fv(n?.uRasterMonoColor0??this.uRasterMonoColor0,e.monochrome.colors.subarray(0,4)),r.uniform4fv(n?.uRasterMonoColor1??this.uRasterMonoColor1,e.monochrome.colors.subarray(4,8))),r.uniform4fv(n?.uRasterQuad??this.uRasterQuad,e.quad??vc),r.uniform4fv(n?.uRasterUv??this.uRasterUv,e.uv??vc),t){for(let e=0;e<t.count;e+=2147483647){let n=Math.min(2147483647,t.count-e);e&&(r.bindBuffer(r.ARRAY_BUFFER,t.buffer),r.vertexAttribPointer(1,4,r.FLOAT,!1,24,e*24),r.vertexAttribPointer(2,2,r.FLOAT,!1,24,e*24+16)),r.drawArraysInstanced(r.TRIANGLE_STRIP,0,4,n),this.frameDrawCalls++}t.count>2147483647&&(r.vertexAttribPointer(1,4,r.FLOAT,!1,24,0),r.vertexAttribPointer(2,2,r.FLOAT,!1,24,16))}else r.drawArrays(r.TRIANGLE_STRIP,0,4),this.frameDrawCalls++}rasterRepeatProgram=null;drawRasterRepeatLayer(e,t,n,r,i,a){let o=this.gl;if(!this.rasterRepeatProgram){let e=Zn(Tn);this.paintFoldUnit>=0&&(e=Jr(e,!0));let t=this.createProgram(Rn(wn),e);try{let e=this.mustGetUniformMap(t,[`uViewport`,`uCameraCenter`,`uZoom`,`uUseLocalToClip`,`uLocalToClip`,`uRasterTex`,`uRasterOpacity`,`uRasterQuad`,`uRasterUv`,`uRasterMonochrome`,`uRasterMonoMips`,`uRasterMonoSize`,`uRasterMonoColor0`,`uRasterMonoColor1`,`uRasterOpaque`]);this.paintFoldUnit>=0&&(o.useProgram(t),o.uniform1i(o.getUniformLocation(t,`uPaintMask`),this.paintFoldUnit)),this.rasterRepeatProgram={program:t,uniforms:e}}catch(e){throw o.deleteProgram(t),e}}let{program:s,uniforms:c}=this.rasterRepeatProgram;o.useProgram(s),this.bindVectorClip(s),this.bindPaintFold(s),o.bindVertexArray(e.repeat.vao),this.setGradientViewUniforms(c,t,n,r,i,a),o.uniform1i(c.uRasterTex,12),o.uniform1i(c.uRasterMonoMips,13),o.uniform1f(c.uRasterOpacity,e.opacity),this.multiplyPass==null?o.blendFuncSeparate(o.ONE,o.ONE_MINUS_SRC_ALPHA,o.ONE,o.ONE_MINUS_SRC_ALPHA):this.setMultiplyBlend(),this.drawRasterTile(e,e.repeat,c);for(let t of e.extraTiles??[])this.drawRasterTile(t,e.repeat,c);this.performanceProfiler?.enabled&&(this.performanceProfiler.add(`rasterRepeatDraws`),this.performanceProfiler.add(`rasterRepeatCells`,e.repeat.count)),this.multiplyPass??o.blendFuncSeparate(o.SRC_ALPHA,o.ONE_MINUS_SRC_ALPHA,o.ONE,o.ONE_MINUS_SRC_ALPHA)}drawRasterStripBatch(e,t,n,r,i,a){let o=this.gl,{program:s,uniforms:c}=this.rasterStripProgram;o.useProgram(s),this.bindVectorClip(s),o.bindVertexArray(e.vao),o.uniform2f(c.uViewport,t,n),o.uniform2f(c.uCameraCenter,r,i),o.uniform1f(c.uZoom,a),o.uniform1f(c.uUseLocalToClip,+!!this.localToClipRenderingEnabled),this.localToClipRenderingEnabled&&o.uniformMatrix4fv(c.uLocalToClip,!1,this.localToClipMatrix),this.bindOrderedTexture(12,e.texture),o.uniform1i(c.uRasterStripTex,12),o.uniform2f(c.uRasterStripSize,e.width,e.height),o.blendFuncSeparate(o.ONE,o.ONE_MINUS_SRC_ALPHA,o.ONE,o.ONE_MINUS_SRC_ALPHA),o.drawArraysInstanced(o.TRIANGLE_STRIP,0,4,e.count),this.frameDrawCalls++,o.blendFuncSeparate(o.SRC_ALPHA,o.ONE_MINUS_SRC_ALPHA,o.ONE,o.ONE_MINUS_SRC_ALPHA)}drawRasterAtlasBatch(e,t,n,r,i,a,o,s){let c=this.gl,{program:l,uniforms:u}=this.rasterAtlasProgram;c.useProgram(l),this.bindVectorClip(l),this.bindPaintFold(l),c.bindVertexArray(e.vao),c.bindBuffer(c.ARRAY_BUFFER,e.buffer);for(let n=0;n<3;n++)c.vertexAttribPointer(n,4,c.FLOAT,!1,48,(t-e.first)*48+n*16);this.prepareOrderedProgram(l)&&(this.setGradientViewUniforms(u,r,i,a,o,s),c.uniform1i(u.uRasterAtlasTex,12)),this.bindOrderedTexture(12,e.texture),c.uniform2f(u.uRasterAtlasSize,e.width,e.height),c.blendFuncSeparate(c.ONE,c.ONE_MINUS_SRC_ALPHA,c.ONE,c.ONE_MINUS_SRC_ALPHA),c.drawArraysInstanced(c.TRIANGLE_STRIP,0,4,n),this.frameDrawCalls++,c.blendFuncSeparate(c.SRC_ALPHA,c.ONE_MINUS_SRC_ALPHA,c.ONE,c.ONE_MINUS_SRC_ALPHA)}drawRasterTextureBatch(e,t,n,r,i,a,o){let s=this.gl;if(this.rasterTextureBatchUnavailable)return!1;if(!this.rasterTextureBatch){let e=null,t=null,n=null;try{let r=this.paintFoldUnit>=0?Jr(pr,!0):pr;e=this.createProgram(fr,r);let i=this.mustGetUniformMap(e,[`uViewport`,`uCameraCenter`,`uZoom`,`uUseLocalToClip`,`uLocalToClip`,...Array.from({length:14},(e,t)=>`uRasterBatchTex${t}`)]);t=this.mustCreateBuffer(),n=this.createVertexArray(),this.initializeRasterTextureBatchVao(t,n),this.paintFoldUnit>=0&&(s.useProgram(e),s.uniform1i(s.getUniformLocation(e,`uPaintMask`),this.paintFoldUnit)),this.rasterTextureBatch={program:e,uniforms:i,buffer:t,vao:n}}catch(r){return s.deleteProgram(e),s.deleteBuffer(t),s.deleteVertexArray(n),this.rasterTextureBatchUnavailable=!0,console.warn(`Raster texture batching unavailable; drawing original image layers.`,r),!1}}let{program:c,uniforms:l}=this.rasterTextureBatch;if(s.useProgram(c),this.bindVectorClip(c),this.bindPaintFold(c),this.bindRasterTextureBatchGeometry(t),this.prepareOrderedProgram(c)){this.setGradientViewUniforms(l,n,r,i,a,o);for(let e=0;e<14;e++)s.uniform1i(l[`uRasterBatchTex${e}`],e)}for(let t=0;t<14;t++)this.bindOrderedTexture(t,e[t]??e[0]);s.blendFuncSeparate(s.ONE,s.ONE_MINUS_SRC_ALPHA,s.ONE,s.ONE_MINUS_SRC_ALPHA),s.drawArraysInstanced(s.TRIANGLE_STRIP,0,4,t),this.frameDrawCalls++;let u=this.performanceProfiler?.enabled?this.performanceProfiler:null;return u?.geometryDiagnostics&&this.profileRasterTextureQuadAreas(u,n,r,i,a,o,t),s.blendFuncSeparate(s.SRC_ALPHA,s.ONE_MINUS_SRC_ALPHA,s.ONE,s.ONE_MINUS_SRC_ALPHA),!0}initializeRasterTextureBatchVao(e,t){let n=this.gl;n.bindVertexArray(t),n.bindBuffer(n.ARRAY_BUFFER,e);for(let e=0;e<7;e++)n.enableVertexAttribArray(e),n.vertexAttribPointer(e,e===6?2:e===2?3:4,n.FLOAT,!1,112,e*16),n.vertexAttribDivisor(e,1)}bindRasterTextureBatchGeometry(e){let t=this.gl,n=this.rasterTextureBatchInstances,r=e*28,i=r*4,a=this.rasterTextureBatchCacheCursor++,o=this.rasterTextureBatchCache??=[];this.rasterTextureBatchCacheBytes??=0;let s=o[a],c=s?.instances.length===r;if(c){for(let e=0;e<r;e++)if(s.instances[e]!==n[e]){c=!1;break}}let l=this.performanceProfiler?.enabled?this.performanceProfiler:null;if(c){t.bindVertexArray(s.vao),l?.add(`rasterTextureBatchCacheHits`);return}if(l?.add(`rasterTextureBatchCacheMisses`),!this.rasterTextureBatchCacheUnavailable&&a<512&&this.rasterTextureBatchCacheBytes-(s?.instances.byteLength??0)+i<=4194304){let e=null,c=null;try{s||=(e=this.mustCreateBuffer(),c=this.createVertexArray(),this.initializeRasterTextureBatchVao(e,c),{buffer:e,vao:c,instances:/* @__PURE__ */ new Float32Array}),t.bindVertexArray(s.vao),t.bindBuffer(t.ARRAY_BUFFER,s.buffer);let u=n.slice(0,r);t.bufferData(t.ARRAY_BUFFER,u,t.STATIC_DRAW),this.rasterTextureBatchCacheBytes+=i-s.instances.byteLength,s.instances=u,o[a]=s,l?.add(`rasterTextureInstanceUploadBytes`,i);return}catch(n){o[a]===s&&s&&(this.rasterTextureBatchCacheBytes-=s.instances.byteLength,t.deleteBuffer(s.buffer),t.deleteVertexArray(s.vao),o[a]=void 0),t.deleteBuffer(e),t.deleteVertexArray(c),this.rasterTextureBatchCacheUnavailable=!0,console.warn(`Raster batch geometry cache unavailable; streaming image instances.`,n)}}let u=this.rasterTextureBatch;t.bindVertexArray(u.vao),t.bindBuffer(t.ARRAY_BUFFER,u.buffer),t.bufferData(t.ARRAY_BUFFER,n.subarray(0,r),t.DYNAMIC_DRAW),l?.add(`rasterTextureInstanceUploadBytes`,i)}destroyRasterTextureBatchCache(){for(let e of this.rasterTextureBatchCache??[])e&&(this.gl.deleteBuffer(e.buffer),this.gl.deleteVertexArray(e.vao));this.rasterTextureBatchCache=[],this.rasterTextureBatchCacheBytes=0,this.rasterTextureBatchCacheCursor=0}profileRasterTextureQuadAreas(e,t,n,r,i,a,o){if(this.localToClipRenderingEnabled||!(a>0)||!Number.isFinite(a))return;let s=this.rasterTextureBatchInstances,c=Math.max(1/Math.max(a,1e-6),1e-4),l=0,u=0,d=0,f=0,p=0;for(let e=0;e<o;e++){let o=e*28,m=s[o],h=s[o+1],g=s[o+2],_=s[o+3],v=s[o+4],y=s[o+5],b=(e,o,s,c)=>{let l=v+Math.min(m*e,m*s)+Math.min(g*o,g*c),u=y+Math.min(h*e,h*s)+Math.min(_*o,_*c),d=v+Math.max(m*e,m*s)+Math.max(g*o,g*c),f=y+Math.max(h*e,h*s)+Math.max(_*o,_*c);return Math.max(0,Math.min(t,Math.ceil((d-r)*a+t/2))-Math.max(0,Math.floor((l-r)*a+t/2)))*Math.max(0,Math.min(n,Math.ceil((f-i)*a+n/2))-Math.max(0,Math.floor((u-i)*a+n/2)))};l+=b(0,0,1,1);let x=s[o+7];x>=0&&x*4+3<(this.vectorClipBounds?.length??0)&&d++;let S=s[o+12],C=s[o+13],w=s[o+14],T=s[o+15];if(S>w||C>T){f++,p++;continue}if(S=Math.max(0,S-s[o+9]*c),C=Math.max(0,C-s[o+10]*c),w=Math.min(1,w+s[o+9]*c),T=Math.min(1,T+s[o+10]*c),S>w||C>T){f++,p++;continue}(S>0||C>0||w<1||T<1)&&f++,u+=b(S,C,w,T)}e.add(`rasterTextureUnclippedQuadPixelsEstimate`,l),e.add(`rasterTextureQuadPixelsEstimate`,u),e.add(`rasterTextureClipBoundsTestedInstances`,d),e.add(`rasterTextureClipBoundedInstances`,f),e.add(`rasterTextureClipCulledInstances`,p)}drawRasterLayer(e,t,n,r,i=this.zoom){if(this.rasterLayers.length===0&&this.pageRects.length===0)return;let a=this.gl;if(this.drawPageBackgrounds(e,t,n,r,i),this.rasterLayers.length!==0){this.prepareRasterProgram(e,t,n,r,i),a.blendFuncSeparate(a.ONE,a.ONE_MINUS_SRC_ALPHA,a.ONE,a.ONE_MINUS_SRC_ALPHA);for(let a of this.orderedGradientPaintCommands)a.kind===`raster`&&this.drawRasterLayerAtIndex(a.index,e,t,n,r,i,!0);a.blendFuncSeparate(a.SRC_ALPHA,a.ONE_MINUS_SRC_ALPHA,a.ONE,a.ONE_MINUS_SRC_ALPHA)}}drawSearchHighlights(e,t,n,r,i=this.zoom){if(this.primitiveHighlights){let a=this.resolveClientToPixelScale();this.frameDrawCalls+=this.primitiveHighlights.draw(this.localToClipRenderingEnabled?this.localToClipMatrix:Xa(n,r,i,e,t),this.localToClipRenderingEnabled&&this.scene?li(this.localToClipMatrix,{width:e,height:t},this.scene.bounds):1/Math.max(i,1e-6),Math.max(a.x,a.y))}if(this.highlightOthersCount===0&&this.highlightCurrentCount===0&&this.highlightSelectionCount===0)return;let a=this.gl;a.useProgram(this.highlightProgram),a.uniform2f(this.uHighlightViewport,e,t),a.uniform2f(this.uHighlightCameraCenter,n,r),a.uniform1f(this.uHighlightZoom,i),a.uniform1f(this.uHighlightMinSizePx,2),a.uniform1f(this.uHighlightUseLocalToClip,+!!this.localToClipRenderingEnabled),this.localToClipRenderingEnabled&&a.uniformMatrix4fv(this.uHighlightLocalToClip,!1,this.localToClipMatrix),this.highlightSelectionCount>0&&(a.bindVertexArray(this.highlightSelectionVao),this.drawHighlightBatch(this.highlightSelectionCount,cc,lc,1)),this.highlightOthersCount>0&&(a.bindVertexArray(this.highlightOthersVao),this.drawHighlightBatch(this.highlightOthersCount,ic,ac,1)),this.highlightCurrentCount>0&&(a.bindVertexArray(this.highlightCurrentVao),this.drawHighlightBatch(this.highlightCurrentCount,oc,sc,2)),a.bindVertexArray(null)}drawHighlightBatch(e,t,n,r){let i=this.gl;i.uniform4f(this.uHighlightFillColor,t[0],t[1],t[2],t[3]),i.uniform4f(this.uHighlightBorderColor,n[0],n[1],n[2],n[3]),i.uniform1f(this.uHighlightBorderPx,r),i.drawArraysInstanced(i.TRIANGLE_STRIP,0,4,e),this.frameDrawCalls++}uploadVectorClips(e){let t=this.gl,n=t.getParameter(t.MAX_TEXTURE_SIZE);if(t.isContextLost?.())throw Error(`WebGL context was lost before uploading vector clipping.`);if(!Number.isSafeInteger(n)||n<1)throw Error(`WebGL did not report a valid maximum texture size for vector clipping.`);this.rasterTextureClipBounds=/* @__PURE__ */ new WeakMap,this.vectorClipTexture&&t.deleteTexture(this.vectorClipTexture),this.vectorClipBoundsTexture&&t.deleteTexture(this.vectorClipBoundsTexture),this.vectorClipBoundsTexture=null;let r=o(e.clipPaths,Math.min(h,n**2),{cells:!0,onStats:e=>{this.vectorClipPackingStats=e}});this.vectorClipStoreTexels=r.length/4,this.vectorClipHeaders=r.slice(0,(e.clipPaths?.length??0)*4),this.vectorClipBounds=f(e.clipPaths);let i=r.length/4,a=Math.min(n,Math.max(1,Math.ceil(Math.sqrt(i)))),s=Math.ceil(i/a);if(s>n)throw RangeError(`Vector clip data exceeds GPU texture capacity.`);let c=new Float32Array(a*s*4);if(c.set(r),this.vectorClipTexture=t.createTexture(),!this.vectorClipTexture)throw Error(`Unable to allocate the vector clip texture.`);if(t.bindTexture(t.TEXTURE_2D,this.vectorClipTexture),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MIN_FILTER,t.NEAREST),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MAG_FILTER,t.NEAREST),t.texImage2D(t.TEXTURE_2D,0,t.RGBA32F,a,s,0,t.RGBA,t.FLOAT,c),this.vectorClipBounds.length)try{let e=this.vectorClipBounds.length/4,r=Math.min(n,Math.ceil(Math.sqrt(e))),i=Math.ceil(e/r);if(i>n)throw RangeError(`Fill clip bounds exceed GPU texture capacity.`);let a=new Float32Array(r*i*4);if(a.set(this.vectorClipBounds),this.vectorClipBoundsTexture=t.createTexture(),!this.vectorClipBoundsTexture)throw Error(`Unable to allocate the fill clip bounds texture.`);t.bindTexture(t.TEXTURE_2D,this.vectorClipBoundsTexture),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MIN_FILTER,t.NEAREST),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MAG_FILTER,t.NEAREST),t.texImage2D(t.TEXTURE_2D,0,t.RGBA32F,r,i,0,t.RGBA,t.FLOAT,a)}catch(e){t.deleteTexture(this.vectorClipBoundsTexture),this.vectorClipBoundsTexture=null,console.warn(`Fill clip bounds unavailable; drawing original fill quads.`,e)}this.vectorClipIndex=-1}bindVectorClip(e){let t=this.vectorClipIndex===-2||this.orderedStateActive,n=+!!this.paintShapeOnly|(this.multiplyPass==null?0:2);(!t||this.orderedPaintUniformStates?.get(e)!==n)&&(this.paintShapeUniforms.has(e)||this.paintShapeUniforms.set(e,this.gl.getUniformLocation(e,`uPdfShapeOnly`)),this.gl.uniform1f(this.paintShapeUniforms.get(e),+!!this.paintShapeOnly),this.multiplyUniforms&&(this.multiplyUniforms.has(e)||this.multiplyUniforms.set(e,this.gl.getUniformLocation(e,`uHeprMultiply`)),this.gl.uniform1i(this.multiplyUniforms.get(e),this.multiplyPass==null?0:1)),t?this.orderedPaintUniformStates?.set(e,n):this.orderedPaintUniformStates?.delete(e));let r=this.gl,i=this.vectorClipUniforms.get(e);i||(i=[r.getUniformLocation(e,`uVectorClipTex`),r.getUniformLocation(e,`uVectorClipIndex`)],this.vectorClipUniforms.set(e,i));let a=this.usesDedicatedPaintUnits()?18:15;this.bindOrderedTexture(a,this.vectorClipTexture);let o=this.vectorClipIndex*32+a;t&&this.orderedClipStates?.get(e)===o||(r.uniform1i(i[0],a),r.uniform1f(i[1],this.vectorClipIndex),t?(this.orderedClipStates??=/* @__PURE__ */ new Map).set(e,o):this.orderedClipStates?.delete(e))}bindOrderedTexture(e,t){let n=this.orderedTextureBindings;if(n&&(this.vectorClipIndex===-2||this.orderedStateActive)){if(n[e]===t)return;n[e]=t}this.gl.activeTexture(this.gl.TEXTURE0+e),this.gl.bindTexture(this.gl.TEXTURE_2D,t)}initializePaintFold(){let e=this.gl,t=this.mustCreateTexture();e.activeTexture(e.TEXTURE0+this.paintFoldUnit),e.bindTexture(e.TEXTURE_2D,t),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.NEAREST),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.NEAREST),e.texImage2D(e.TEXTURE_2D,0,e.RGBA8,1,1,0,e.RGBA,e.UNSIGNED_BYTE,Uint8Array.of(255,255,255,255)),e.activeTexture(e.TEXTURE0),this.paintFoldNeutralTexture=t;for(let t of[this.fillProgram,this.gradientFillProgram,this.rasterProgram,this.pageBackgroundProgram])e.useProgram(t),e.uniform4f(this.paintFoldLocations(t)[0],1,0,0,0),e.uniform1i(e.getUniformLocation(t,`uPaintMask`),this.paintFoldUnit),(this.paintFoldStates??=/* @__PURE__ */ new Map).set(t,null);e.useProgram(null)}paintFoldLocations(e){let t=this.paintFoldUniforms.get(e);return t||(t=[this.gl.getUniformLocation(e,`uPaintFold`),this.gl.getUniformLocation(e,`uPaintMaskWeights`),this.gl.getUniformLocation(e,`uPaintMaskGradient`)],this.paintFoldUniforms.set(e,t)),t}bindPaintFold(e){if(!(this.paintFoldUnit>=0))return;let t=this.paintFold;t?.mask&&this.bindOrderedTexture(this.paintFoldUnit,t.mask);let n=this.paintFoldStates??=/* @__PURE__ */ new Map;if(n.get(e)===t)return;n.set(e,t);let[r,i,a]=this.paintFoldLocations(e);if(!t?.mask){this.gl.uniform4f(r,t?.opacity??1,0,0,0);return}let o=t.weights;this.gl.uniform4f(r,t.opacity,t.gradient?2:1,o[4],0),t.gradient&&this.gl.uniform4fv(a,t.gradient),this.gl.uniform4f(i,o[0],o[1],o[2],o[3])}canFoldPaint(e){return!(this.paintFoldUnit>=0)||e.count!==1?!1:e.kind===`fill`||e.kind===`raster`||e.kind===`gradient-fill`&&!(this.gradientMeshRanges?.[e.first*2+1]??0)}invalidateOrderedState(){(this.paintCompositor?.firstUnit??0)>18||this.resetOrderedState()}resetOrderedState(){this.orderedTextureBindings&&(this.orderedTextureBindings.length=0),this.orderedUniformPrograms?.clear(),this.orderedPaintUniformStates?.clear(),this.orderedClipStates?.clear()}prepareOrderedProgram(e){return this.vectorClipIndex!==-2&&!this.orderedStateActive||!this.orderedUniformPrograms.has(e)&&(this.orderedUniformPrograms.add(e),!0)}usesDedicatedPaintUnits(){return(this.vectorClipIndex===-2||this.orderedStateActive)&&this.orderedDedicatedTextureUnits}bindOrderedInstanceAttribute(e,t){let n=this.gl;this.vectorClipIndex===-2?(n.bindBuffer(n.ARRAY_BUFFER,this.orderedInstanceBuffer),n.vertexAttribPointer(e,1,n.FLOAT,!1,8,t*8),this.orderedInstanceVaos?.has(e)||(n.enableVertexAttribArray(4),n.vertexAttribDivisor(4,1),this.orderedInstanceVaos?.add(e)),n.vertexAttribPointer(4,1,n.FLOAT,!1,8,t*8+4)):(n.disableVertexAttribArray(4),this.orderedInstanceVaos?.delete(e),n.vertexAttribPointer(e,1,n.FLOAT,!1,4,t*4))}drawSourceOrderedContent(e,t,n,r,i,a=null){this.rasterTextureBatchCacheCursor=0,this.resetOrderedState(),this.orderedInstanceVaos?.clear(),this.orderedStateActive=!0;try{return this.drawSourceOrderedFrame(e,t,n,r,i,a)}finally{this.orderedStateActive=!1;let e=this.rasterTextureBatchCache;if(e&&this.rasterTextureBatchCacheCursor<e.length){for(let t=this.rasterTextureBatchCacheCursor;t<e.length;t++){let n=e[t];n&&(this.gl.deleteBuffer(n.buffer),this.gl.deleteVertexArray(n.vao),this.rasterTextureBatchCacheBytes-=n.instances.byteLength)}e.length=this.rasterTextureBatchCacheCursor}(this.performanceProfiler?.enabled?this.performanceProfiler:null)?.add(`rasterTextureBatchCacheBytes`,this.rasterTextureBatchCacheBytes??0)}}drawSourceOrderedFrame(e,t,n,r,i,a){let o=this.performanceProfiler?.enabled?this.performanceProfiler:null;this.vectorClipIndex=-1,this.rasterRenderingEnabled&&this.drawPageBackgrounds(e,t,n,r,i);let s=0;o?.beginSection(`paintVisibility`);let c=this.localToClipRenderingEnabled?this.orderedCullingBounds:De(e,t,n,r,i),l=this.orderedRunCuller?.select(c,1/Math.max(i,1e-6),this.orderedBatches?.cullingPadding)??this.scene.drawRuns,u=this.optionalContentVisibility,d=this.scenePaintVisibility??=new $e(this.scene);d.setVisibility(u);let f=d.select(l);if(o?.endSection(`paintVisibility`),o?.add(`visiblePaints`,f.length),o?.add(`sourcePaints`,this.scene.drawRuns.length),o?.add(`fillClipBoundsAvailable`,+!!this.vectorClipBoundsTexture),o?.add(`fillClipBoundsTexels`,this.vectorClipBoundsTexture?this.vectorClipBounds.length/4:0),o?.add(`vectorClipStoreTexels`,this.vectorClipStoreTexels??0),o&&this.vectorClipPackingStats){let e=this.vectorClipPackingStats;o.add(`vectorClipUniquePayloads`,e.uniquePayloads),o.add(`vectorClipSharedPayloads`,e.sharedPayloads),o.add(`vectorClipRectangleNodes`,e.rectangleNodes),o.add(`vectorClipCellIndexedNodes`,e.cellIndexedNodes),o.add(`vectorClipBandIndexedNodes`,e.bandIndexedNodes),o.add(`vectorClipUnindexedPolygonNodes`,e.unindexedPolygonNodes),o.add(`vectorClipCoarsenedCellNodes`,e.coarsenedCellNodes)}this.orderedRunsCulled=f.length<this.scene.drawRuns.length;let p=this.orderedBatches;o?.beginSection(`batchPreparation`),this.orderedTextLod&&this.updateTextLodSelection(e,t,n,r,i);let m=p?.update(f,this.localToClipRenderingEnabled?null:1/Math.max(i,1e-6))??!1;o?.endSection(`batchPreparation`),this.orderedRunsCulled||=this.strokeRenderingEnabled&&(p?.culledSegmentCount??0)>0,p&&m&&(o?.add(`batchRebuilds`),o?.add(`instanceUploadBytes`,p.instanceCount*8),o?.beginSection(`instanceUpload`),this.gl.bindBuffer(this.gl.ARRAY_BUFFER,this.orderedInstanceBuffer),this.gl.bufferData(this.gl.ARRAY_BUFFER,p.floatInstances.subarray(0,p.instanceCount*2),this.gl.DYNAMIC_DRAW),o?.endSection(`instanceUpload`));let h=null;p&&!d.requiresCompositing&&this.mixedVectorBatchingEnabled&&(this.fillRenderingEnabled||this.strokeRenderingEnabled)&&!this.mixedVectorBatchingUnavailable&&(o?.beginSection(`batchPreparation`),h=this.prepareMixedVectorBatches(p),o?.endSection(`batchPreparation`));let g=[],_=[],v=(a,s=!0)=>{o?.add(`drawBatches`),o?.add(`rasterInstances`);let c=s&&this.multiplyPass==null?this.rasterAtlasBatches?.get(a):void 0;if(c)this.drawRasterAtlasBatch(c,a,1,e,t,n,r,i),o?.add(`rasterAtlasBatches`);else{let s=this.frameDrawCalls;this.drawRasterLayerAtIndex(a,e,t,n,r,i),o?.add(`rasterStandaloneDraws`,this.frameDrawCalls-s)}},y=()=>{if(!g.length)return;let a=this.vectorClipIndex;this.vectorClipIndex=-1;try{if(g.length>1&&this.drawRasterTextureBatch(_,g.length,e,t,n,r,i))o?.add(`drawBatches`),o?.add(`rasterTextureBatches`),o?.add(`rasterTextureBatchInstances`,g.length),o?.add(`rasterInstances`,g.length);else for(let e=0;e<g.length;e++)this.vectorClipIndex=this.rasterTextureBatchInstances[e*28+7],v(g[e])}finally{this.vectorClipIndex=a,g.length=_.length=0}},b=e=>{let t=this.rasterLayers?.[e];if(!t||t.repeat||t.monochrome||t.compressionFormat||t.quad||t.uv||t.extraTiles?.length||this.rasterTextureBatchUnavailable)return!1;let n=_.indexOf(t.texture);(g.length===512||n<0&&_.length===14)&&(y(),n=-1),n<0&&(n=_.length,_.push(t.texture));let r=g.length*28,i=this.rasterTextureBatchInstances??=/* @__PURE__ */ new Float32Array(14336);i.set(t.matrix,r),i[r+6]=t.opacity,i[r+7]=this.vectorClipIndex,i[r+8]=n;let a=this.rasterTextureClipBounds??=/* @__PURE__ */ new WeakMap,o=a.get(t);o||(o=/* @__PURE__ */ new Map,a.set(t,o));let s=o.get(this.vectorClipIndex);if(!s){let e=this.vectorClipIndex*4;s=lr(t.matrix,this.vectorClipBounds&&e>=0&&e+3<this.vectorClipBounds.length?this.vectorClipBounds.subarray(e,e+4):void 0),o.set(this.vectorClipIndex,s)}i.set(s,r+9);let c=this.rasterTileSeams?.get(e);return i.set(c?.bounds??yc,r+16),i.set(c?.gaps??yc,r+20),i[r+24]=c?.maxFootprint[0]??0,i[r+25]=c?.maxFootprint[1]??0,g.push(e),!0},x=a=>{if((a.kind!==`raster`||a.blendMode||this.multiplyPass!=null)&&y(),this.vectorClipIndex=a.clipIndex??-1,a.kind===`fill`&&this.fillRenderingEnabled)o?.add(`drawBatches`),o?.add(`fillBatches`),o?.add(`fillInstances`,a.count),this.drawFilledPaths(e,t,n,r,i,a.first,a.count);else if(a.kind===`stroke`&&this.strokeRenderingEnabled){o?.add(`drawBatches`),o?.add(`strokeBatches`),o?.add(`strokeInstances`,a.count);let c=p?this.vectorLodLevels[0]:void 0;c?(this.drawStrokeInstances(c,this.vectorClipIndex===-2?this.orderedInstanceBuffer:this.allSegmentIdBuffer,a.count,e,t,n,r,i,a.first),s+=a.count):s+=this.drawVisibleSegments(e,t,n,r,i,{start:a.first,count:a.count})}else if(a.kind===`text`&&this.textRenderingEnabled)o?.add(`drawBatches`),o?.add(`textBatches`),o?.add(`glyphInstances`,a.count),this.drawTextInstances(e,t,n,r,i,void 0,{start:a.first,count:a.count});else for(let s=a.first;s<a.first+a.count;s++)if(a.kind===`raster`&&this.rasterRenderingEnabled){let c=this.multiplyPass==null&&!a.blendMode?this.rasterAtlasBatches?.get(s):void 0,l=!d.requiresCompositing&&this.multiplyPass==null&&!a.blendMode?this.rasterStripBatches?.get(s):void 0,u=c?Math.min(a.first+a.count-s,c.first+c.count-s):0;c&&u>1?(y(),o?.add(`drawBatches`),this.drawRasterAtlasBatch(c,s,u,e,t,n,r,i),o?.add(`rasterAtlasBatches`),o?.add(`rasterInstances`,u),s+=u-1):l&&s+l.count<=a.first+a.count?(y(),o?.add(`drawBatches`),this.drawRasterStripBatch(l,e,t,n,r,i),o?.add(`rasterStripBatches`),o?.add(`rasterInstances`,l.count),s+=l.count-1):(this.multiplyPass!=null||a.blendMode||!b(s))&&(y(),v(s,!a.blendMode))}else a.kind===`gradient-fill`&&this.fillRenderingEnabled?(o?.add(`drawBatches`),this.drawGradientFillPath(s,e,t,n,r,i)):a.kind===`gradient-stroke`&&this.strokeRenderingEnabled&&(o?.add(`drawBatches`),this.drawGradientStrokeRun(s,e,t,n,r,i))};if(o?.beginSection(`drawSubmission`),d.requiresCompositing){this.paintCompositor??=new Gr(this.gl,()=>{this.frameDrawCalls++});let c=this.paintFoldUnit>=0?{canFold:e=>this.canFoldPaint(e),canFoldMaskPaint:(e,t)=>this.fillRenderingEnabled&&this.vectorOverrideOpacity===0&&!this.primitiveColors?.gradient(`gradient-fill`,t.first),draw:(e,t,n,r,i)=>{this.invalidateOrderedState(),this.paintShapeOnly=!1,i&&o?.add(`computedMasks`),this.paintFold={opacity:t,mask:i?this.gradientLutTexture:n,weights:Kr(r),gradient:i},o?.add(`foldedPaints`);try{x(e),y()}finally{this.paintFold=null,(n||i)&&this.bindOrderedTexture(this.paintFoldUnit,this.paintFoldNeutralTexture)}}}:null,l=p?.colorBatchingEnabled??!1,f=p?.blackDarkenSourceOverEnabled??!1,m=Be(this.scene,l,f);try{this.paintCompositor.render(this.scene,e,t,(e,t)=>{this.invalidateOrderedState(),this.paintShapeOnly=t;let n=s;$r(e,p,m,this.runLookup,x),y(),t&&(s=n)},e=>e===void 0||u?.conditions[e]===1,this.orderedRunCuller?.selected??null,this.localToClipRenderingEnabled?null:a=>({x:(a.minX-n)*i+e/2,y:(a.minY-r)*i+t/2,width:(a.maxX-a.minX)*i,height:(a.maxY-a.minY)*i}),this.localToClipRenderingEnabled?void 0:{framebuffer:a,readFramebuffer:a,viewport:[0,0,e,t],clearColor:[pc,mc,hc,1],scissor:!1,blend:!0,depth:!1,program:null,vao:null,blendFunction:[this.gl.SRC_ALPHA,this.gl.ONE_MINUS_SRC_ALPHA,this.gl.ONE,this.gl.ONE_MINUS_SRC_ALPHA],blendEquation:[this.gl.FUNC_ADD,this.gl.FUNC_ADD]},c,l,d.revision,f),o?.add(this.paintCompositor.paintPlanReused?`cachedPaintPlans`:`paintPlanBuilds`),o?.add(`paintPlanOperations`,this.paintCompositor.paintPlanOperations)}finally{this.paintShapeOnly=!1,this.vectorClipIndex=-1,o?.endSection(`drawSubmission`)}return s}for(let a of h?.batches??p?.batches??f){if(a.kind===`mixed-vector`){y(),this.vectorClipIndex=-2,this.drawMixedVectorBatch(a,e,t,n,r,i),this.strokeRenderingEnabled&&(s+=a.strokeCount),o?.add(`drawBatches`),o?.add(`mixedVectorBatches`),o?.add(`fillInstances`,this.fillRenderingEnabled?a.fillCount:0),o?.add(`strokeInstances`,this.strokeRenderingEnabled?a.strokeCount:0);continue}if(!a.blendMode){x(a);continue}y();for(let e=a.first;e<a.first+a.count;e++)for(let t of[0,1])this.multiplyPass=t,this.setMultiplyBlend(),x({...a,first:e,count:1});a.kind===`stroke`&&this.strokeRenderingEnabled&&(s-=a.count),this.multiplyPass=null,this.gl.blendFuncSeparate(this.gl.SRC_ALPHA,this.gl.ONE_MINUS_SRC_ALPHA,this.gl.ONE,this.gl.ONE_MINUS_SRC_ALPHA)}return y(),this.vectorClipIndex=-1,o?.endSection(`drawSubmission`),s}prepareMixedVectorBatches(e){try{let t=this.mixedVectorBatches??=new Gi;if(t.update(e),!t.instanceCount)return null;let n=this.mixedVectorGpu;if(!n){let e=this.gl;if(e.getParameter(e.MAX_VERTEX_TEXTURE_IMAGE_UNITS)<8||e.getParameter(e.MAX_TEXTURE_IMAGE_UNITS)<3||e.getParameter(e.MAX_VARYING_VECTORS)<10||e.getParameter(e.MAX_COMBINED_TEXTURE_IMAGE_UNITS)<(this.orderedDedicatedTextureUnits?19:16))throw Error(`The context cannot bind the mixed vector shader's textures and varyings.`);let t=null,r=null,i=null;try{t=this.createProgram(Zi,ea);let a=this.mustGetUniformMap(t,/* @__PURE__ */ `uSegmentTexA.uSegmentTexB.uSegmentStyleTex.uSegmentBoundsTex.uSegmentTexSize.uFillPathMetaTexA.uFillPathMetaTexB.uFillPathMetaTexC.uFillSegmentTexA.uFillSegmentTexB.uFillPathMetaTexSize.uFillSegmentTexSize.uFillBandBase.uFillCellHeaders.uFillBandEntries.uFillClipBoundsEnabled.uFillClipBoundsTex.uViewport.uCameraCenter.uZoom.uAAScreenPx.uFillAAScreenPx.uUseLocalToClip.uLocalToClip.uLocalUnitsPerPixel.uStrokeCurveEnabled.uVectorOverride.uMixedVectorEnabled`.split(`.`));r=this.mustCreateBuffer(),i=this.createVertexArray(),e.bindVertexArray(i),e.bindBuffer(e.ARRAY_BUFFER,this.cornerBuffer),e.enableVertexAttribArray(0),e.vertexAttribPointer(0,2,e.FLOAT,!1,0,0),e.bindBuffer(e.ARRAY_BUFFER,r);for(let t of[1,4,5])e.enableVertexAttribArray(t),e.vertexAttribDivisor(t,1);n=this.mixedVectorGpu={program:t,uniforms:a,buffer:r,vao:i,revision:-1}}catch(n){throw e.deleteVertexArray(i),e.deleteBuffer(r),e.deleteProgram(t),n}}if(n.revision!==t.revision){let e=this.performanceProfiler?.enabled?this.performanceProfiler:null;e?.beginSection(`instanceUpload`);try{this.gl.bindBuffer(this.gl.ARRAY_BUFFER,n.buffer),this.gl.bufferData(this.gl.ARRAY_BUFFER,t.floatInstances.subarray(0,t.instanceCount*3),this.gl.DYNAMIC_DRAW),n.revision=t.revision,e?.add(`mixedVectorInstanceUploadBytes`,t.instanceCount*12)}finally{e?.endSection(`instanceUpload`)}}return t}catch(e){return this.mixedVectorBatchingUnavailable=!0,this.destroyMixedVectorResources(),console.warn(`Mixed vector batching unavailable; using separate fill/stroke draws.`,e),null}}destroyMixedVectorResources(){let e=this.mixedVectorGpu;e&&(this.gl.deleteProgram(e.program),this.gl.deleteBuffer(e.buffer),this.gl.deleteVertexArray(e.vao),this.orderedUniformPrograms.delete(e.program),this.orderedClipStates?.delete(e.program),this.orderedPaintUniformStates.delete(e.program),this.multiplyUniforms.delete(e.program),this.paintShapeUniforms.delete(e.program),this.vectorClipUniforms.delete(e.program)),this.mixedVectorGpu=null,this.mixedVectorBatches=null}drawMixedVectorBatch(e,t,n,r,i,a){let o=this.mixedVectorGpu,s=this.gl,c=o.uniforms;s.useProgram(o.program),this.bindVectorClip(o.program),s.bindVertexArray(o.vao),s.bindBuffer(s.ARRAY_BUFFER,o.buffer),s.vertexAttribPointer(1,1,s.FLOAT,!1,12,e.first*12),s.vertexAttribPointer(4,1,s.FLOAT,!1,12,e.first*12+4),s.vertexAttribPointer(5,1,s.FLOAT,!1,12,e.first*12+8);for(let[e,t]of[this.segmentTextureA,this.segmentTextureB,this.segmentTextureC,this.segmentTextureD,this.fillPathMetaTextureA,this.fillPathMetaTextureB,this.fillPathMetaTextureC,this.fillSegmentTextureA,this.fillSegmentTextureB].entries())this.bindOrderedTexture(e,t);if(this.bindOrderedTexture(this.fillClipBoundsUnit,this.vectorClipBoundsTexture??this.vectorClipTexture),this.prepareOrderedProgram(o.program)){for(let[e,t]of[`uSegmentTexA`,`uSegmentTexB`,`uSegmentStyleTex`,`uSegmentBoundsTex`,`uFillPathMetaTexA`,`uFillPathMetaTexB`,`uFillPathMetaTexC`,`uFillSegmentTexA`,`uFillSegmentTexB`].entries())s.uniform1i(c[t],e);s.uniform2i(c.uSegmentTexSize,this.segmentTextureWidth,this.segmentTextureHeight),s.uniform2i(c.uFillPathMetaTexSize,this.fillPathMetaTextureWidth,this.fillPathMetaTextureHeight),s.uniform2i(c.uFillSegmentTexSize,this.fillSegmentTextureWidth,this.fillSegmentTextureHeight),s.uniform1i(c.uFillBandBase,this.fillBandBase),s.uniform1i(c.uFillCellHeaders,this.fillCellBase+1),s.uniform1i(c.uFillBandEntries,this.fillBandEntries),s.uniform1i(c.uFillClipBoundsEnabled,+!!this.vectorClipBoundsTexture),s.uniform1i(c.uFillClipBoundsTex,this.fillClipBoundsUnit),s.uniform2f(c.uViewport,t,n),s.uniform2f(c.uCameraCenter,r,i),s.uniform1f(c.uZoom,a),s.uniform1f(c.uAAScreenPx,1),s.uniform1f(c.uFillAAScreenPx,1),s.uniform2f(c.uMixedVectorEnabled,+!!this.strokeRenderingEnabled,+!!this.fillRenderingEnabled),s.uniform1f(c.uUseLocalToClip,+!!this.localToClipRenderingEnabled),this.localToClipRenderingEnabled&&s.uniformMatrix4fv(c.uLocalToClip,!1,this.localToClipMatrix),s.uniform1f(c.uLocalUnitsPerPixel,this.localUnitsPerPixel),s.uniform1f(c.uStrokeCurveEnabled,+!!this.strokeCurveEnabled),s.uniform4f(c.uVectorOverride,...this.vectorOverrideColor,this.vectorOverrideOpacity)}this.lastMixedVectorDrawFirst=e.first,s.drawArraysInstanced(s.TRIANGLE_STRIP,0,4,e.count),this.frameDrawCalls++;let l=this.performanceProfiler?.enabled?this.performanceProfiler:null;this.fillRenderingEnabled&&l?.geometryDiagnostics&&this.profileFillQuadAreas(l,t,n,r,i,a,e.first,e.count,this.mixedVectorBatches.floatInstances)}drawFilledPaths(e,t,n,r,i=this.zoom,a=0,o=this.fillPathCount){if(!this.scene||this.fillPathCount<=0)return 0;let s=this.gl;s.useProgram(this.fillProgram),this.bindVectorClip(this.fillProgram),this.bindPaintFold(this.fillProgram),s.bindVertexArray(this.fillVao);let c=this.usesDedicatedPaintUnits()?4:7;this.bindOrderedTexture(c,this.fillPathMetaTextureA),this.bindOrderedTexture(c+1,this.fillPathMetaTextureB),this.bindOrderedTexture(c+2,this.fillPathMetaTextureC),this.bindOrderedTexture(c+3,this.fillSegmentTextureA),this.bindOrderedTexture(c+4,this.fillSegmentTextureB),this.bindOrderedTexture(this.fillClipBoundsUnit??14,this.vectorClipBoundsTexture??this.vectorClipTexture),this.prepareOrderedProgram(this.fillProgram)&&(s.uniform1i(this.uFillPathMetaTexA,c),s.uniform1i(this.uFillPathMetaTexB,c+1),s.uniform1i(this.uFillPathMetaTexC,c+2),s.uniform1i(this.uFillSegmentTexA,c+3),s.uniform1i(this.uFillSegmentTexB,c+4),s.uniform2i(this.uFillPathMetaTexSize,this.fillPathMetaTextureWidth,this.fillPathMetaTextureHeight),s.uniform2i(this.uFillSegmentTexSize,this.fillSegmentTextureWidth,this.fillSegmentTextureHeight),s.uniform2f(this.uFillViewport,e,t),s.uniform2f(this.uFillCameraCenter,n,r),s.uniform1f(this.uFillZoom,i),s.uniform1f(this.uFillAAScreenPx,1),s.uniform1i(this.uFillBandBase,this.fillBandBase),s.uniform1i(this.uFillCellHeaders,this.fillCellBase+1),s.uniform1i(this.uFillClipBoundsEnabled,+!!this.vectorClipBoundsTexture),s.uniform1i(this.uFillClipBoundsTex,this.fillClipBoundsUnit??14),s.uniform1i(this.uFillBandEntries,this.fillBandEntries),s.uniform1f(this.uFillUseLocalToClip,+!!this.localToClipRenderingEnabled),this.localToClipRenderingEnabled&&s.uniformMatrix4fv(this.uFillLocalToClip,!1,this.localToClipMatrix),s.uniform4f(this.uFillVectorOverride,this.vectorOverrideColor[0],this.vectorOverrideColor[1],this.vectorOverrideColor[2],this.vectorOverrideOpacity)),this.vectorClipIndex!==-2&&s.bindBuffer(s.ARRAY_BUFFER,this.allFillPathIdBuffer),this.bindOrderedInstanceAttribute(3,a),this.lastFillDrawFirst=a,s.drawArraysInstanced(s.TRIANGLE_STRIP,0,4,o),this.frameDrawCalls++;let l=this.performanceProfiler?.enabled?this.performanceProfiler:null;return l?.geometryDiagnostics&&this.profileFillQuadAreas(l,e,t,n,r,i,a,o),o}profileFillQuadAreas(e,t,n,r,i,a,o,s,c){if(this.localToClipRenderingEnabled||!(a>0)||!Number.isFinite(a))return;let l=this.scene;if(!l?.fillPathMetaA||!l.fillPathMetaB||!l.fillPathMetaC)return;let u=this.vectorClipIndex===-2,d=c??(u?this.orderedBatches?.uintInstances:null);if(u&&!d)return;let f=this.vectorClipBounds,p=this.fillCoverageMetadata,m=p?.pathMetaA??l.fillPathMetaA,h=p?.pathMetaB??l.fillPathMetaB,g=(e,o,s,c)=>Math.max(0,Math.min(t,Math.ceil((s-r)*a+t/2))-Math.max(0,Math.floor((e-r)*a+t/2)))*Math.max(0,Math.min(n,Math.ceil((c-i)*a+n/2))-Math.max(0,Math.floor((o-i)*a+n/2))),_=0,v=0,y=0,b=0,x=0;for(let e=o;e<o+s;e++){if(c&&c[e*3+2]!==1)continue;let t=c?3:2,n=(u?d[e*t]:e)*4;if(n+3>=l.fillPathMetaA.length||!(l.fillPathMetaA[n+1]>0)||!this.paintShapeOnly&&!(l.fillPathMetaC[n+3]>.001))continue;let r=p&&p.pathMetaC[n]>=0?Math.max(.5/a,5e-5)+1e-5/a:1/a,i=m[n+2],o=m[n+3],s=h[n],S=h[n+1],C=i-r,w=o-r,T=s+r,E=S+r;_+=g(C,w,T,E);let D=u?d[e*t+1]-1:this.vectorClipIndex;if(this.vectorClipBoundsTexture&&D>=0&&f&&D*4+3<f.length){y++;let e=D*4;if(f[e]>f[e+2]||f[e+1]>f[e+3]){b++,x++;continue}C=Math.max(i,f[e])-r,w=Math.max(o,f[e+1])-r,T=Math.min(s,f[e+2])+r,E=Math.min(S,f[e+3])+r,(C>i-r||w>o-r||T<s+r||E<S+r)&&b++}C>T||w>E?x++:v+=g(C,w,T,E)}e.add(`fillUnclippedQuadPixelsEstimate`,_),e.add(`fillQuadPixelsEstimate`,v),e.add(`fillClipBoundsTestedInstances`,y),e.add(`fillClipBoundedInstances`,b),e.add(`fillClipCulledInstances`,x)}drawVisibleSegments(e,t,n,r,i=this.zoom,a){if(!a&&this.vectorLodRuntime&&this.vectorLodLevels.length>0)return this.drawVectorLodSegments(e,t,n,r,i);let o=a?.count??(this.usingAllSegments?this.segmentCount:this.visibleSegmentCount);if(o===0)return 0;let s=a||this.usingAllSegments?this.allSegmentIdBuffer:this.visibleSegmentIdBuffer;return this.drawStrokeInstances({textureA:this.segmentTextureA,textureB:this.segmentTextureB,textureC:this.segmentTextureC,textureD:this.segmentTextureD,textureWidth:this.segmentTextureWidth,textureHeight:this.segmentTextureHeight,ownsTextures:!1},s,o,e,t,n,r,i,a?.start??0),o}drawVectorLodSegments(e,t,n,r,i){if(!this.vectorLodRuntime)return 0;let a=0;for(let o=0;o<this.vectorLodRuntime.levels.length;o+=1){let s=this.vectorLodRuntime.levels[o],c=this.vectorLodLevels[o],l=Math.max(0,s.visibleSegmentCount|0);!c||l<=0||(this.drawStrokeInstances(c,c.visibleSegmentIdBuffer,l,e,t,n,r,i),a+=l)}return a}drawStrokeInstances(e,t,n,r,i,a,o,s,c=0){let l=this.gl;l.useProgram(this.segmentProgram),this.bindVectorClip(this.segmentProgram),l.bindVertexArray(this.segmentVao),this.vectorClipIndex!==-2&&l.bindBuffer(l.ARRAY_BUFFER,t),this.bindOrderedInstanceAttribute(1,c),this.bindOrderedTexture(0,e.textureA),this.bindOrderedTexture(1,e.textureB),this.bindOrderedTexture(2,e.textureC),this.bindOrderedTexture(3,e.textureD),this.prepareOrderedProgram(this.segmentProgram)&&(l.uniform1i(this.uSegmentTexA,0),l.uniform1i(this.uSegmentTexB,1),l.uniform1i(this.uSegmentStyleTex,2),l.uniform1i(this.uSegmentBoundsTex,3),l.uniform2i(this.uSegmentTexSize,e.textureWidth,e.textureHeight),l.uniform2f(this.uViewport,r,i),l.uniform2f(this.uCameraCenter,a,o),l.uniform1f(this.uZoom,s),l.uniform1f(this.uAAScreenPx,1),l.uniform1f(this.uUseLocalToClip,+!!this.localToClipRenderingEnabled),l.uniform1f(this.uLocalUnitsPerPixel,this.localUnitsPerPixel),this.localToClipRenderingEnabled&&l.uniformMatrix4fv(this.uLocalToClip,!1,this.localToClipMatrix),l.uniform1f(this.uStrokeCurveEnabled,+!!this.strokeCurveEnabled),l.uniform4f(this.uStrokeVectorOverride,this.vectorOverrideColor[0],this.vectorOverrideColor[1],this.vectorOverrideColor[2],this.vectorOverrideOpacity)),l.drawArraysInstanced(l.TRIANGLE_STRIP,0,4,n),this.frameDrawCalls++}drawTextInstances(e,t,n,r,i=this.zoom,a,o){if(!this.scene||this.textInstanceCount<=0)return 0;let s=!o&&this.updateTextLodSelection(a?.viewportWidth??e,a?.viewportHeight??t,a?.cameraCenterX??n,a?.cameraCenterY??r,a?.zoom??i);if(!o&&(s?this.selectedTextInstanceCount<=0:this.visibleTextRanges.length===0))return 0;let c=this.gl;c.useProgram(this.textProgram),this.bindVectorClip(this.textProgram),c.bindVertexArray(this.textVao),this.vectorClipIndex!==-2&&c.bindBuffer(c.ARRAY_BUFFER,s?this.selectedTextInstanceIdBuffer:this.allTextInstanceIdBuffer);let l=this.usesDedicatedPaintUnits(),u=l?9:2,d=l?17:13;return this.bindOrderedTexture(u,this.textInstanceTextureA),this.bindOrderedTexture(u+1,this.textInstanceTextureB),this.bindOrderedTexture(u+2,this.textInstanceTextureC),this.bindOrderedTexture(u+3,this.textGlyphMetaTextureA),this.bindOrderedTexture(u+4,this.textGlyphMetaTextureB),this.bindOrderedTexture(u+5,this.textGlyphSegmentTextureA),this.bindOrderedTexture(u+6,this.textGlyphSegmentTextureB),this.bindOrderedTexture(u+7,this.textGlyphRasterMetaTexture),this.bindOrderedTexture(d,this.textRasterAtlasTexture),this.prepareOrderedProgram(this.textProgram)&&(c.uniform1i(this.uTextInstanceTexA,u),c.uniform1i(this.uTextInstanceTexB,u+1),c.uniform1i(this.uTextInstanceTexC,u+2),c.uniform1i(this.uTextGlyphMetaTexA,u+3),c.uniform1i(this.uTextGlyphMetaTexB,u+4),c.uniform1i(this.uTextGlyphSegmentTexA,u+5),c.uniform1i(this.uTextGlyphSegmentTexB,u+6),c.uniform1i(this.uTextGlyphRasterMetaTex,u+7),c.uniform1i(this.uTextRasterAtlasTex,d),c.uniform2i(this.uTextInstanceTexSize,this.textInstanceTextureWidth,this.textInstanceTextureHeight),c.uniform2i(this.uTextGlyphMetaTexSize,this.textGlyphMetaTextureWidth,this.textGlyphMetaTextureHeight),c.uniform2i(this.uTextGlyphSegmentTexSize,this.textGlyphSegmentTextureWidth,this.textGlyphSegmentTextureHeight),c.uniform2f(this.uTextRasterAtlasSize,this.textRasterAtlasWidth,this.textRasterAtlasHeight),c.uniform2f(this.uTextViewport,e,t),c.uniform2f(this.uTextCameraCenter,n,r),c.uniform1f(this.uTextZoom,i),c.uniform1f(this.uTextAAScreenPx,1.25),c.uniform1f(this.uTextUseLocalToClip,+!!this.localToClipRenderingEnabled),this.localToClipRenderingEnabled&&c.uniformMatrix4fv(this.uTextLocalToClip,!1,this.localToClipMatrix),c.uniform1f(this.uTextCurveEnabled,+!!this.strokeCurveEnabled),c.uniform1f(this.uTextVectorOnly,+!!this.textVectorOnly),c.uniform4f(this.uTextVectorOverride,this.vectorOverrideColor[0],this.vectorOverrideColor[1],this.vectorOverrideColor[2],this.vectorOverrideOpacity)),s?(this.bindOrderedInstanceAttribute(2,0),c.drawArraysInstanced(c.TRIANGLE_STRIP,0,4,this.selectedTextInstanceCount),this.frameDrawCalls++,this.selectedTextInstanceCount):this.drawTextInstanceRanges(o?[o]:this.visibleTextRanges)}updateTextLodSelection(e,t,n,r,i){let a=this.textLodRuntime;if(!a||!this.textLodGpuActive||this.textLodMode===`off`)return this.orderedTextLod&&this.orderedBatches?.setTextSelection(null),!1;let o=this.localToClipRenderingEnabled?this.localToClipMatrix:Xa(n,r,i,e,t),s=a.update({localToClip:o,viewportWidth:e,viewportHeight:t,pixelRatio:`clientWidth`in this.canvas&&this.canvas.clientWidth>0?this.canvas.width/this.canvas.clientWidth:1});if(this.selectedTextInstanceCount=s.instanceIds.length,this.orderedTextLod)return this.orderedTextLod.update(s),this.orderedBatches?.setTextSelection(this.orderedTextLod),!0;if(!s.changed)return!0;this.selectedTextInstanceIds.length<s.instanceIds.length&&(this.selectedTextInstanceIds=new Float32Array(s.instanceIds.length));for(let e=0;e<s.instanceIds.length;e+=1)this.selectedTextInstanceIds[e]=s.instanceIds[e];return this.gl.bindBuffer(this.gl.ARRAY_BUFFER,this.selectedTextInstanceIdBuffer),this.gl.bufferData(this.gl.ARRAY_BUFFER,this.selectedTextInstanceIds.subarray(0,s.instanceIds.length),this.gl.DYNAMIC_DRAW),!0}drawTextInstanceRanges(e){let t=this.gl,n=0;for(let r of e)r.count<=0||(this.bindOrderedInstanceAttribute(2,r.start),t.drawArraysInstanced(t.TRIANGLE_STRIP,0,4,r.count),this.frameDrawCalls++,n+=r.count);return n}destroyVectorMinifyResources(){this.vectorMinifyFramebuffer&&=(this.gl.deleteFramebuffer(this.vectorMinifyFramebuffer),null),this.vectorMinifyTexture&&=(this.gl.deleteTexture(this.vectorMinifyTexture),null),this.vectorMinifyWidth=0,this.vectorMinifyHeight=0,this.vectorMinifyWarmupPending=!1}updateVisibleSet(e=this.cameraCenterX,t=this.cameraCenterY,n=this.canvas.width,r=this.canvas.height,i=this.zoom){if(!this.scene){this.visibleSegmentCount=0,this.usingAllSegments=!0,this.visiblePageRectCount=0,this.visibleTextRanges=[];return}if(!this.vectorLodRuntime&&!this.hasCameraInteractionSinceSceneLoad){this.usingAllSegments=!0,this.visibleSegmentCount=this.segmentCount,this.setAllPagesAndTextVisible();return}let a=Math.max(i,1e-6),o=n/(2*a),s=r/(2*a),c=Math.max(16/a,this.scene.maxHalfWidth*2),l=e-o-c,u=e+o+c,d=t-s-c,f=t+s+c;if(this.updateVisiblePagesAndTextRanges(l,d,u,f),this.vectorLodRuntime){this.updateVectorLodVisibleSet({cameraCenterX:e,cameraCenterY:t,zoom:a},{width:n,height:r},null,1/a);return}if(!this.grid||this.orderedBatches){this.visibleSegmentCount=this.orderedBatches?this.segmentCount:0,this.usingAllSegments=!0;return}let p=this.grid,m=$(Math.floor((l-p.minX)/p.cellWidth),p.gridWidth),h=$(Math.floor((u-p.minX)/p.cellWidth),p.gridWidth),g=$(Math.floor((d-p.minY)/p.cellHeight),p.gridHeight),_=$(Math.floor((f-p.minY)/p.cellHeight),p.gridHeight);this.usingAllSegments=!1,this.markToken+=1,this.markToken===4294967295&&(this.segmentMarks.fill(0),this.markToken=1);let v=0;for(let e=g;e<=_;e+=1){let t=e*p.gridWidth+m;for(let e=m;e<=h;e+=1){let e=p.offsets[t],n=p.counts[t];for(let t=0;t<n;t+=1){let n=p.indices[e+t];this.segmentMarks[n]!==this.markToken&&(this.segmentMarks[n]=this.markToken,!(this.segmentMaxX[n]<l||this.segmentMinX[n]>u||this.segmentMaxY[n]<d||this.segmentMinY[n]>f)&&(this.visibleSegmentIds[v]=n,v+=1))}t+=1}}this.visibleSegmentCount=v;let y=this.visibleSegmentIds.subarray(0,v);this.gl.bindBuffer(this.gl.ARRAY_BUFFER,this.visibleSegmentIdBuffer),this.gl.bufferData(this.gl.ARRAY_BUFFER,y,this.gl.DYNAMIC_DRAW)}updateVisibleSetForBounds(e,t,n=this.canvas.width,r=this.canvas.height){if(!this.scene){this.visibleSegmentCount=0,this.usingAllSegments=!0,this.visiblePageRectCount=0,this.visibleTextRanges=[];return}let i=Math.max(16*Math.max(t,1e-9),this.scene.maxHalfWidth*2),a=e.minX-i,o=e.minY-i,s=e.maxX+i,c=e.maxY+i;if(this.updateVisiblePagesAndTextRanges(a,o,s,c),this.vectorLodRuntime){this.updateVectorLodVisibleSet({cameraCenterX:this.cameraCenterX,cameraCenterY:this.cameraCenterY,zoom:1/Math.max(t,1e-9)},{width:n,height:r},{minX:a,minY:o,maxX:s,maxY:c},t);return}if(!this.grid||this.orderedBatches){this.visibleSegmentCount=this.orderedBatches?this.segmentCount:0,this.usingAllSegments=!0;return}let l=this.grid,u=$(Math.floor((a-l.minX)/l.cellWidth),l.gridWidth),d=$(Math.floor((s-l.minX)/l.cellWidth),l.gridWidth),f=$(Math.floor((o-l.minY)/l.cellHeight),l.gridHeight),p=$(Math.floor((c-l.minY)/l.cellHeight),l.gridHeight);this.usingAllSegments=!1,this.markToken+=1,this.markToken===4294967295&&(this.segmentMarks.fill(0),this.markToken=1);let m=0;for(let e=f;e<=p;e+=1){let t=e*l.gridWidth+u;for(let e=u;e<=d;e+=1){let e=l.offsets[t],n=l.counts[t];for(let t=0;t<n;t+=1){let n=l.indices[e+t];this.segmentMarks[n]!==this.markToken&&(this.segmentMarks[n]=this.markToken,!(this.segmentMaxX[n]<a||this.segmentMinX[n]>s||this.segmentMaxY[n]<o||this.segmentMinY[n]>c)&&(this.visibleSegmentIds[m]=n,m+=1))}t+=1}}this.visibleSegmentCount=m;let h=this.visibleSegmentIds.subarray(0,m);this.gl.bindBuffer(this.gl.ARRAY_BUFFER,this.visibleSegmentIdBuffer),this.gl.bufferData(this.gl.ARRAY_BUFFER,h,this.gl.DYNAMIC_DRAW)}updateVectorLodVisibleSet(e,t,n,r){if(!this.vectorLodRuntime)return;this.localToClipRenderingEnabled?this.vectorLodRuntime.setLocalToClipTransform(this.localToClipMatrix,r):(this.vectorLodRuntime.setScreenSpaceTransform(),this.vectorLodRuntime.updateForLocalUnitsPerPixel(r));let i=this.vectorLodRuntime.update(e,t,n);if(this.vectorLodStats=this.vectorLodRuntime.getStats(),this.visibleSegmentCount=this.vectorLodStats.renderedSegments,this.usingAllSegments=!1,i){if(this.orderedBatches){this.orderedBatches.invalidate();return}for(let e=0;e<this.vectorLodRuntime.levels.length;e+=1){let t=this.vectorLodRuntime.levels[e],n=this.vectorLodLevels[e];if(!n)continue;let r=Math.max(0,t.visibleSegmentCount|0);n.visibleSegmentIdsFloat.length<r&&(n.visibleSegmentIdsFloat=new Float32Array(Math.min(t.segmentCount,Math.max(r,Math.ceil(n.visibleSegmentIdsFloat.length*1.5)))));for(let e=0;e<r;e+=1)n.visibleSegmentIdsFloat[e]=t.visibleSegmentIds[e];this.gl.bindBuffer(this.gl.ARRAY_BUFFER,n.visibleSegmentIdBuffer),this.gl.bufferData(this.gl.ARRAY_BUFFER,n.visibleSegmentIdsFloat.subarray(0,r),this.gl.DYNAMIC_DRAW)}}}setAllPagesAndTextVisible(){let e=Math.floor(this.pageRects.length/4);this.visiblePageRectIndices.length<e&&(this.visiblePageRectIndices=new Uint32Array(e));for(let t=0;t<e;t+=1)this.visiblePageRectIndices[t]=t;this.visiblePageRectCount=e,this.visibleTextRanges=this.textInstanceCount>0?[{start:0,count:this.textInstanceCount}]:[]}updateVisiblePagesAndTextRanges(e,t,n,r){let i=Math.floor(this.pageRects.length/4);if(i<=0){this.visiblePageRectCount=0,this.visibleTextRanges=this.textInstanceCount>0?[{start:0,count:this.textInstanceCount}]:[];return}this.visiblePageRectIndices.length<i&&(this.visiblePageRectIndices=new Uint32Array(i));let a=[],o=0;for(let s=0;s<i;s+=1){let i=s*4,c=Math.min(this.pageRects[i],this.pageRects[i+2]),l=Math.min(this.pageRects[i+1],this.pageRects[i+3]),u=Math.max(this.pageRects[i],this.pageRects[i+2]),d=Math.max(this.pageRects[i+1],this.pageRects[i+3]);if(u<e||c>n||d<t||l>r)continue;this.visiblePageRectIndices[o]=s,o+=1;let f=s*2,p=this.pageTextRanges[f]??0,m=this.pageTextRanges[f+1]??0;this.appendVisibleTextRange(a,p,m)}this.visiblePageRectCount=o,this.visibleTextRanges=a}appendVisibleTextRange(e,t,n){this.appendVisibleInstanceRange(e,t,n,0,this.textInstanceCount)}appendVisibleInstanceRange(e,t,n,r,i){let a=r+i,o=Q(Math.trunc(t),r,a),s=Q(Math.trunc(n),0,a-o);if(s<=0)return;let c=e[e.length-1];if(c&&o<=c.start+c.count){c.count=Math.max(c.start+c.count,o+s)-c.start;return}e.push({start:o,count:s})}rasterResourceCache=null;sharedRasterTextures=/* @__PURE__ */ new WeakMap;rasterTextureLeases=/* @__PURE__ */ new WeakMap;releasedRasterTextureLeases=/* @__PURE__ */ new WeakSet;rasterPreparationIdentities=/* @__PURE__ */ new WeakMap;nextRasterPreparationIdentity=0;sharedRasterTextureBytes=0;rasterRepeatBufferBytes=0;rasterPreparationRunning=!1;getRasterResourceCache(){return this.rasterResourceCache??=new Ln(e=>this.deleteRasterLayerTextures(e))}trimRasterResourceCache(){let e=Math.max(0,this.estimatedRasterResidentBytes()-(this.rasterResourceCache?.bytes??0));this.rasterResourceCache?.trim(Math.max(0,Dt().bytes-e-(this.rasterStagedBytes??0)))}destroyRasterLayerTextures(e=!1){this.destroyRasterTextureBatchCache(),this.destroyRasterStripBatches(),this.destroyRasterAtlasBatches();for(let t of this.rasterLayers)e?this.getRasterResourceCache().park(t,t.estimatedBytes??0):this.deleteRasterLayerTextures(t);this.rasterLayers=[],this.rasterTileSeams?.clear(),e?this.trimRasterResourceCache():this.rasterResourceCache?.clear(),this.rasterCompression?.releaseWorkspace()}destroyRasterStripBatches(){for(let e of this.rasterStripBatches?.values()??[])this.gl.deleteTexture(e.texture),this.gl.deleteBuffer(e.buffer),this.gl.deleteVertexArray(e.vao);this.rasterStripBatches?.clear()}destroyRasterAtlasBatches(){let e=new Set(this.rasterAtlasBatches?.values());for(let t of e)this.gl.deleteTexture(t.texture),this.gl.deleteBuffer(t.buffer),this.gl.deleteVertexArray(t.vao);this.rasterAtlasBatches?.clear()}uploadRasterAtlasBatches(e,t,n=1/0){let r=this.gl;try{let i=new Set(this.rasterTileSeams?.keys());e.paintGraph||e.rasterLayers.forEach((e,t)=>{e.height===1&&i.add(t)});for(let[e,t]of this.rasterStripBatches??[])for(let n=e;n<e+t.count;n++)i.add(n);let a=ar(e,t,i).filter(e=>{let t=e.data.byteLength+e.instances.byteLength;return t>n?!1:(n-=t,!0)});if(!a.length)return;if(!this.rasterAtlasProgram){let e=this.paintFoldUnit>=0?Jr(ur,!0):ur,t=this.createProgram(`#version 300 es
precision highp float;

layout(location = 0) in vec4 aRasterMatrixABCD;
layout(location = 1) in vec4 aRasterEFOpacity;
layout(location = 2) in vec4 aRasterAtlasRect;
uniform vec2 uViewport;
uniform vec2 uCameraCenter;
uniform float uZoom;
uniform float uUseLocalToClip;
uniform mat4 uLocalToClip;
out vec2 vUv;
out vec2 vWorld;
flat out vec4 vAtlasRect;
flat out float vOpacity;

void main() {
  vec2 uv = vec2(float(gl_VertexID & 1), float(1 - (gl_VertexID >> 1)));
  vec2 world = vec2(
    aRasterMatrixABCD.x * uv.x + aRasterMatrixABCD.z * uv.y + aRasterEFOpacity.x,
    aRasterMatrixABCD.y * uv.x + aRasterMatrixABCD.w * uv.y + aRasterEFOpacity.y
  );
  if (uUseLocalToClip >= 0.5) gl_Position = uLocalToClip * vec4(world, 0.0, 1.0);
  else {
    vec2 screen = (world - uCameraCenter) * uZoom + 0.5 * uViewport;
    gl_Position = vec4(screen / (0.5 * uViewport) - 1.0, 0.0, 1.0);
  }
  vUv = uv; vWorld = world; vAtlasRect = aRasterAtlasRect; vOpacity = aRasterEFOpacity.z;
}
`,e);try{this.rasterAtlasProgram={program:t,uniforms:this.mustGetUniformMap(t,[`uViewport`,`uCameraCenter`,`uZoom`,`uUseLocalToClip`,`uLocalToClip`,`uRasterAtlasTex`,`uRasterAtlasSize`])},this.paintFoldUnit>=0&&(r.useProgram(t),r.uniform1i(r.getUniformLocation(t,`uPaintMask`),this.paintFoldUnit))}catch(e){throw this.rasterAtlasProgram=null,r.deleteProgram(t),e}}for(let e of a){let t=this.mustCreateTexture(),n=null,i=null;try{r.bindTexture(r.TEXTURE_2D,t),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_MIN_FILTER,r.LINEAR),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_MAG_FILTER,r.LINEAR),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_WRAP_S,r.CLAMP_TO_EDGE),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_WRAP_T,r.CLAMP_TO_EDGE),r.texImage2D(r.TEXTURE_2D,0,r.RGBA8,e.width,e.height,0,r.RGBA,r.UNSIGNED_BYTE,e.data),n=this.mustCreateBuffer(),i=this.createVertexArray(),r.bindVertexArray(i),r.bindBuffer(r.ARRAY_BUFFER,n),r.bufferData(r.ARRAY_BUFFER,e.instances,r.STATIC_DRAW);for(let e=0;e<3;e++)r.enableVertexAttribArray(e),r.vertexAttribPointer(e,4,r.FLOAT,!1,48,e*16),r.vertexAttribDivisor(e,1);let a={first:e.first,count:e.count,width:e.width,height:e.height,texture:t,buffer:n,vao:i};for(let t=e.first;t<e.first+e.count;t++)this.rasterAtlasBatches.set(t,a)}catch(e){throw r.deleteTexture(t),r.deleteBuffer(n),r.deleteVertexArray(i),e}}}catch(e){this.destroyRasterAtlasBatches(),console.warn(`Raster atlas batching unavailable; drawing original image layers.`,e)}finally{r.bindVertexArray(null),r.bindBuffer(r.ARRAY_BUFFER,null)}}uploadRasterStripBatches(e,t,n=1/0){let r=this.gl;try{let i=Dn(e,t,`linear`).filter(e=>{for(let t=e.first;t<e.first+e.count;t++)if(this.rasterTileSeams?.has(t))return!1;let t=e.data.byteLength+e.instances.byteLength;return t>n?!1:(n-=t,!0)});if(i.length===0)return;if(!this.rasterStripProgram){let e=this.createProgram(`#version 300 es
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
`,rr);try{this.rasterStripProgram={program:e,uniforms:this.mustGetUniformMap(e,[`uViewport`,`uCameraCenter`,`uZoom`,`uUseLocalToClip`,`uLocalToClip`,`uRasterStripTex`,`uRasterStripSize`])}}catch(t){throw r.deleteProgram(e),t}}for(let e of i){let t=this.mustCreateTexture(),n=null,i=null;try{r.bindTexture(r.TEXTURE_2D,t),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_MIN_FILTER,r.LINEAR),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_MAG_FILTER,r.LINEAR),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_WRAP_S,r.CLAMP_TO_EDGE),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_WRAP_T,r.CLAMP_TO_EDGE),r.texImage2D(r.TEXTURE_2D,0,r.RGBA,e.width,e.height,0,r.RGBA,r.UNSIGNED_BYTE,e.data),n=this.mustCreateBuffer(),i=this.createVertexArray(),r.bindVertexArray(i),r.bindBuffer(r.ARRAY_BUFFER,n),r.bufferData(r.ARRAY_BUFFER,e.instances,r.STATIC_DRAW);for(let e=0;e<2;e++)r.enableVertexAttribArray(e),r.vertexAttribPointer(e,4,r.FLOAT,!1,32,e*16),r.vertexAttribDivisor(e,1);this.rasterStripBatches.set(e.first,{count:e.count,width:e.width,height:e.height,texture:t,buffer:n,vao:i})}catch(e){throw r.deleteTexture(t),r.deleteBuffer(n),r.deleteVertexArray(i),e}}}catch(e){this.destroyRasterStripBatches(),console.warn(`Raster strip batching unavailable; drawing original image layers.`,e)}finally{r.bindVertexArray(null),r.bindBuffer(r.ARRAY_BUFFER,null)}}uploadRasterLayers(e){let t=ht((this.rasterCompression??=new Yt(this.gl)).capabilities)!==null,n=this.getSceneRasterLayers(e).map(e=>this.classifyRasterLayerSource(e,t));this.rasterResolutionPlanner&&this.rasterResolutionSources&&this.rasterResolutionPlanner.inheritTiers(this.rasterResolutionPlanner,this.rasterResolutionSources,n),this.rasterResolutionSources=n;let r=Number(this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE));this.destroyRasterLayerTextures(!0);for(let t=0;t<3;t++){let t=this.planRasterLayerMemory(n);It(t,this);try{for(let[e,r]of n.entries())this.rasterLayers.push(this.createRasterLayerGpu(r,e,t.plans[e],t.compressionFormats[e]));this.updateRasterTileSeams(e),this.rasterLayerUpdates.size===0&&t.resolutionScale===1&&t.compressionFormats.every(e=>!e)&&t.plans.every((e,t)=>e.width===n[t].width&&e.height===n[t].height)&&(this.uploadRasterStripBatches(e,r,Math.max(0,t.budget.bytes-this.estimatedRasterResidentBytes())),this.uploadRasterAtlasBatches(e,r,Math.max(0,t.budget.bytes-this.estimatedRasterResidentBytes())));return}catch(e){if(this.destroyRasterLayerTextures(),!this.retryRasterCompression(t.compressionFormats,e))throw e}}}updateRasterTileSeams(e){let t=this.rasterLayerUpdates.size?{...e,rasterLayers:e.rasterLayers.map((e,t)=>this.rasterLayerUpdates.get(t)??e)}:e;this.rasterTileSeams=zn(t,e=>{let t=this.rasterLayers[e];return!!t&&!t.repeat&&!t.quad&&!t.uv&&!t.extraTiles?.length})}classifyRasterLayerSource(e,t=!1){if(e.monochrome)return e;let n=e.gpuCompression?void 0:T(e.data,e.width,e.height),r=!n&&t&&(!!e.gpuCompression||yt(e).eligible),i=!n&&(e.compressionHint===`scan`||!!e.gpuCompression);return!n&&r===!!e.compressionEligible&&i===!!e.preferCompression?e:Object.assign(Object.create(e,{data:{get:()=>e.data}}),{...n?{monochrome:n}:{},compressionEligible:r,preferCompression:i})}planRasterLayerMemory(e,t){let n=this.rasterCompression??=new Yt(this.gl),r=ht(n.capabilities),i=Number(this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE)),a=t=>this.rasterResolutionPlanner?this.rasterResolutionPlanner.plan(e,i,this.rasterResolutionView,t,r):Mt(e,i,t,r),o=a(t);if(o.compressionFormats.some(Boolean)){let e=Math.min(qt,o.budget.bytes/4);o=a(Math.max(0,o.availableBytes-e))}else n.workspaceBytes>0&&(o=a(Math.max(0,o.availableBytes-n.workspaceBytes)));return o}updateRasterResolution(){let e=this.rasterResolutionPlanner;if(!e||!this.scene||!this.rasterTextureResidencyEnabled||!this.rasterRenderingEnabled||(this.rasterResolutionView={width:this.canvas.width,height:this.canvas.height,cameraCenterX:this.cameraCenterX,cameraCenterY:this.cameraCenterY,zoom:this.zoom,...this.localToClipRenderingEnabled?{localToClip:this.localToClipMatrix}:{}},this.rasterStagedBytes>0||this.rasterPreparationRunning))return;let t=ht((this.rasterCompression??=new Yt(this.gl)).capabilities)!==null,n=this.rasterResolutionSources??=this.getSceneRasterLayers(this.scene).map(e=>this.classifyRasterLayerSource(e,t)),r=this.planRasterLayerMemory(n),i=e.nextChange(n,this.rasterLayers,r);if(i<0)return;It(r,this);let a=this.scene,o=n[i],s=r.plans[i];this.rasterPreparationRunning=!0;let c=performance.now();(_c(o,s)||gc(o,s,r.compressionFormats[i])||this.rasterResourceCache?.has(o,s,r.compressionFormats[i])?Promise.resolve(void 0):Pn(o,s)).then(e=>{if(this.isDisposed||this.scene!==a||this.rasterResolutionSources!==n||!this.rasterTextureResidencyEnabled||this.rasterStagedBytes>0)return;this.rasterResolutionView={width:this.canvas.width,height:this.canvas.height,cameraCenterX:this.cameraCenterX,cameraCenterY:this.cameraCenterY,zoom:this.zoom,...this.localToClipRenderingEnabled?{localToClip:this.localToClipMatrix}:{}};let t=this.planRasterLayerMemory(n);if(!ie(t.plans[i],s)||t.compressionFormats[i]!==r.compressionFormats[i])return;this.recordPerformanceTransition(`rasterRefinement.prepare`,performance.now()-c);let l=this.createRasterLayerGpu(o,i,s,r.compressionFormats[i],e);this.destroyRasterTextureBatchCache(),this.destroyRasterStripBatches(),this.destroyRasterAtlasBatches(),this.getRasterResourceCache().park(this.rasterLayers[i],this.rasterLayers[i].estimatedBytes??0),this.rasterLayers[i]=l,this.updateRasterTileSeams(a),this.trimRasterResourceCache(),this.destroyVectorMinifyResources()}).catch(t=>{e.failed(i,r),console.warn(`[HEPR] Raster refinement unavailable; retaining the previous display resolution.`,t)}).finally(()=>{this.rasterPreparationRunning=!1,this.resetOrderedState(),this.isDisposed||this.requestFrame()})}retryRasterCompression(e,t){let n=e.find(Boolean);return!n||n===ht(this.rasterCompression.capabilities)?!1:(console.warn(`[HEPR] WebGL ${n} raster compression unavailable; replanning raster memory with fallback textures.`,t),!0)}estimatedRasterResidentBytes(){let e=(this.sharedRasterTextureBytes??0)+(this.rasterRepeatBufferBytes??0);e+=(this.rasterLayers??[]).reduce((e,t)=>e+(this.rasterTextureLeases?.has(t)?0:t.estimatedBytes??0),0);for(let t of this.rasterStripBatches?.values()??[])e+=t.width*t.height*4+t.count*32;for(let t of new Set(this.rasterAtlasBatches?.values()))e+=t.width*t.height*4+t.count*48;return e+(this.rasterCompression?.workspaceBytes??0)}createRasterLayerGpu(e,t,n,r,i){let a=this.gl,o=Number(a.getParameter(a.MAX_TEXTURE_SIZE)),s=n??re(e.width,e.height,o),c=this.getRasterResourceCache().take(e,s,r);if(c)return this.recordPerformanceTransition(`rasterUpload.cacheHit`,0),c;let l=performance.now();i??=e.gpuPreparation,i&&!ie(i.plan,s)&&(i=void 0),this.rasterResolutionPlanner||te(t,e,s,o);let u=e.monochrome??(e.gpuCompression?void 0:T(e.data,e.width,e.height)),d=u&&s.width===e.width&&s.height===e.height,f=!!u&&!d&&!!this.rasterResolutionPlanner,p=!u&&gc(e,s,r)?e.gpuCompression.tiles:void 0,m=this.rasterPreparationIdentities??=/* @__PURE__ */ new WeakMap,h=e=>{if(!e)return 0;let t=m.get(e);return t===void 0&&m.set(e,t=this.nextRasterPreparationIdentity=(this.nextRasterPreparationIdentity??0)+1),t},g=`${e.width}:${e.height}:${s.width}:${s.height}:${s.tiles.map(e=>`${e.x},${e.y},${e.width},${e.height},${e.quad.join(`,`)},${e.uv.join(`,`)}`).join(`;`)}:${r??``}:${e.interpolate===!1?`nearest`:`smooth`}:${f?`coverage`:d?`packed`:`rgba`}:${u?Array.from(u.colors).join(`,`):``}:${h(i)}:${h(p?e.gpuCompression:void 0)}`,_=e.monochrome?.data??e.data,v=this.sharedRasterTextures??=/* @__PURE__ */ new WeakMap,y=v.get(_);y||v.set(_,y=/* @__PURE__ */ new Map);let b=y.get(g);if(b)return this.recordPerformanceTransition(`rasterUpload.sharedTextureHit`,0),this.createRasterTextureLease(e,s,r,b);let x=p?[]:i?.pixels??(d?[]:f?D(u,e.width,e.height,s):ae(u?this.classifyRasterLayerSource(e):e,s)),S=[];try{for(let[t,n]of s.tiles.entries()){if(f){let r=this.createMonochromeRasterTile(u,n.width,n.height,i?.coverageAtlases?.[t],x[t],i?.compactAtlases?.[t],!!i?.compactAtlases,e.interpolate);S.push(s.tiles.length>1?{...r,quad:Float32Array.from(n.quad),uv:Float32Array.from(n.uv)}:r);continue}if(d){let r=this.createMonochromeRasterTile(i?.monochromeTiles?.[t]??O(u,e.width,e.height,n),n.width,n.height,i?.coverageAtlases?.[t],void 0,i?.compactAtlases?.[t],!!i?.compactAtlases,e.interpolate);S.push(s.tiles.length>1?{...r,quad:Float32Array.from(n.quad),uv:Float32Array.from(n.uv)}:r);continue}if(r){let i=this.rasterCompression??=new Yt(a),o=p?i.uploadEncoded(p[t],n.width,n.height,r):i.upload(x[t],n.width,n.height,r,Math.min(qt,Dt().bytes/4)),c=n.uv.map((e,t)=>e*o.uvScale[t%2]);e.interpolate===!1&&(a.bindTexture(a.TEXTURE_2D,o.texture),wc(a,!1)),S.push({texture:o.texture,compressionFormat:r,...s.tiles.length>1?{quad:Float32Array.from(n.quad)}:{},...s.tiles.length>1||o.uvScale.some(e=>e!==1)?{uv:Float32Array.from(c)}:{}});continue}let o=this.mustCreateTexture();S.push(s.tiles.length>1?{texture:o,quad:Float32Array.from(n.quad),uv:Float32Array.from(n.uv)}:{texture:o}),a.bindTexture(a.TEXTURE_2D,o),wc(a,e.interpolate),a.texImage2D(a.TEXTURE_2D,0,a.RGBA,n.width,n.height,0,a.RGBA,a.UNSIGNED_BYTE,x[t]),a.generateMipmap(a.TEXTURE_2D)}}catch(e){for(let e of S)this.deleteRasterTileTextures(e);throw e}for(let t of S)t.interpolate=e.interpolate;let C=At({width:e.width,height:e.height,monochrome:u,reducedMonochrome:f},s,r)-S.reduce((e,t,n)=>e+(t.monochrome?.estimatedBytes===void 0?0:Ot(s.tiles[n].width,s.tiles[n].height,!!d,null,f)-t.monochrome.estimatedBytes),0);u&&wt({width:e.width,height:e.height,monochrome:u},s,C);let w={tiles:S,estimatedBytes:C,references:0,entries:y,key:g};return y.set(g,w),this.sharedRasterTextureBytes=(this.sharedRasterTextureBytes??0)+C,this.recordPerformanceTransition(`rasterUpload.submit`,performance.now()-l),this.createRasterTextureLease(e,s,r,w)}createRasterTextureLease(e,t,n,r){let i=/* @__PURE__ */ new Float32Array(6);e.matrix.length>=6?i.set(e.matrix.subarray(0,6)):(i[0]=1,i[3]=1);let[a,...o]=r.tiles,s={...a,rasterPlan:t,estimatedBytes:r.estimatedBytes,...o.length>0?{extraTiles:o}:{},opacity:e.opacity??1,matrix:i,paintOrder:e.paintOrder??0,pageIndex:e.pageIndex??0};r.references++,(this.rasterTextureLeases??=/* @__PURE__ */ new WeakMap).set(s,r);try{e.repeat&&(s.repeat=this.createRasterRepeatGpu(e.repeat),s.estimatedBytes+=s.repeat.bytes)}catch(e){throw this.deleteRasterLayerTextures(s),e}return this.getRasterResourceCache().remember(s,e,t,n)}createRasterRepeatGpu(e){let t=w(e),n=this.gl,r=this.mustCreateBuffer(),i=null;try{i=this.createVertexArray(),n.bindVertexArray(i),n.bindBuffer(n.ARRAY_BUFFER,this.cornerBuffer),n.enableVertexAttribArray(0),n.vertexAttribPointer(0,2,n.FLOAT,!1,0,0),n.bindBuffer(n.ARRAY_BUFFER,r),n.bufferData(n.ARRAY_BUFFER,t,n.STATIC_DRAW);for(let e=1;e<=2;e++)n.enableVertexAttribArray(e),n.vertexAttribPointer(e,e===1?4:2,n.FLOAT,!1,24,e===1?0:16),n.vertexAttribDivisor(e,1);return this.rasterRepeatBufferBytes=(this.rasterRepeatBufferBytes??0)+t.byteLength,{buffer:r,vao:i,count:A(e),bytes:t.byteLength}}catch(e){throw n.deleteBuffer(r),n.deleteVertexArray(i),e}finally{n.bindVertexArray(null),n.bindBuffer(n.ARRAY_BUFFER,null)}}deleteRasterLayerTextures(e){if(this.releasedRasterTextureLeases?.has(e))return;e.repeat&&(this.gl.deleteBuffer(e.repeat.buffer),this.gl.deleteVertexArray(e.repeat.vao),this.rasterRepeatBufferBytes-=e.repeat.bytes);let t=this.rasterTextureLeases?.get(e);if(t){if(this.rasterTextureLeases.delete(e),(this.releasedRasterTextureLeases??=/* @__PURE__ */ new WeakSet).add(e),--t.references===0){t.entries.delete(t.key),this.sharedRasterTextureBytes-=t.estimatedBytes;for(let e of t.tiles)this.deleteRasterTileTextures(e)}return}this.deleteRasterTileTextures(e);for(let t of e.extraTiles??[])this.deleteRasterTileTextures(t)}deleteRasterTileTextures(e){this.gl.deleteTexture(e.texture),e.monochrome&&e.monochrome.mipTexture!==e.texture&&this.gl.deleteTexture(e.monochrome.mipTexture)}createMonochromeRasterTile(e,t,n,r,i,a,o=!1,s){let c=this.gl,l=r??(i?ee(i,t,n):k(e,t,n)),u=s===!1?void 0:o?a:Vt(e,t,n,l,i),d=this.mustCreateTexture(),f=null;try{f=u?d:this.mustCreateTexture(),c.pixelStorei(c.UNPACK_ALIGNMENT,1),c.bindTexture(c.TEXTURE_2D,d),c.texParameteri(c.TEXTURE_2D,c.TEXTURE_MIN_FILTER,i&&s!==!1?c.LINEAR:c.NEAREST),c.texParameteri(c.TEXTURE_2D,c.TEXTURE_MAG_FILTER,i&&s!==!1?c.LINEAR:c.NEAREST),c.texParameteri(c.TEXTURE_2D,c.TEXTURE_WRAP_S,c.CLAMP_TO_EDGE),c.texParameteri(c.TEXTURE_2D,c.TEXTURE_WRAP_T,c.CLAMP_TO_EDGE),u?c.texImage2D(c.TEXTURE_2D,0,c.RGBA8,u.width,u.height,0,c.RGBA,c.UNSIGNED_BYTE,u.data):(c.texImage2D(c.TEXTURE_2D,0,c.R8,i?t:Math.ceil(t/8),n,0,c.RED,c.UNSIGNED_BYTE,i??e.data),c.bindTexture(c.TEXTURE_2D,f),c.texParameteri(c.TEXTURE_2D,c.TEXTURE_MIN_FILTER,c.NEAREST),c.texParameteri(c.TEXTURE_2D,c.TEXTURE_MAG_FILTER,c.NEAREST),c.texParameteri(c.TEXTURE_2D,c.TEXTURE_WRAP_S,c.CLAMP_TO_EDGE),c.texParameteri(c.TEXTURE_2D,c.TEXTURE_WRAP_T,c.CLAMP_TO_EDGE),c.texImage2D(c.TEXTURE_2D,0,c.R8,l.width,l.height,0,c.RED,c.UNSIGNED_BYTE,l.data));let r=/* @__PURE__ */ new Float32Array(8);for(let t=0;t<8;t+=4){let n=e.colors[t+3]/255;for(let i=0;i<3;i++)r[t+i]=Math.round(e.colors[t+i]*n)/255;r[t+3]=n}return{texture:d,monochrome:{mipTexture:f,width:t,height:n,colors:r,coverage:!!i,compact:!!u,estimatedBytes:u?.data.length}}}catch(e){throw c.deleteTexture(d),f!==d&&c.deleteTexture(f),e}finally{c.pixelStorei(c.UNPACK_ALIGNMENT,4)}}getSceneRasterLayers(e){let t=[];if(Array.isArray(e.rasterLayers))for(let n=0;n<e.rasterLayers.length;n++){let r=this.rasterLayerUpdates.get(n)??e.rasterLayers[n],i=Math.max(0,Math.trunc(r?.width??0)),a=Math.max(0,Math.trunc(r?.height??0));if(i<=0||a<=0||(r.monochrome?r.monochrome.colors.length!==8||r.monochrome.data.length<Math.ceil(i/8)*a:!(r.data instanceof Uint8Array)||r.data.length<i*a*4))continue;let o=Number.isFinite(r.paintOrder)?r.paintOrder:0,s=Number.isFinite(r.pageIndex)?Math.max(0,Math.trunc(r.pageIndex)):0;r.width===i&&r.height===a&&r.matrix instanceof Float32Array&&r.paintOrder===o&&r.pageIndex===s?t.push(r):t.push(Object.assign(Object.create(r,{data:{get:()=>r.data}}),{width:i,height:a,paintOrder:o,pageIndex:s,matrix:r.matrix instanceof Float32Array?r.matrix:new Float32Array(r.matrix)}))}if(t.length>0)return t;let n=Math.max(0,Math.trunc(e.rasterLayerWidth)),r=Math.max(0,Math.trunc(e.rasterLayerHeight));return n<=0||r<=0||e.rasterLayerData.length<n*r*4||t.push({width:n,height:r,data:e.rasterLayerData,matrix:e.rasterLayerMatrix,paintOrder:0,pageIndex:0}),t}uploadGradientPaintData(e){let t=n(e);this.gradientData=t;let r=this.gl;if(r.deleteBuffer(this.gradientMeshBuffer),this.gradientMeshBuffer=null,r.deleteVertexArray(this.gradientMeshVao),this.gradientMeshVao=null,this.gradientMeshRanges=/* @__PURE__ */ new Uint32Array,t.gradientMeshIndices?.length){let e=le(t);this.gradientMeshRanges=e.ranges,this.gradientMeshProgram||(this.gradientMeshProgram=this.createProgram(Sr,Cr),this.gradientMeshUniforms=Object.fromEntries([...Object.keys(this.gradientFillUniforms),`uMeshPathIndex`].map(e=>[e,r.getUniformLocation(this.gradientMeshProgram,e)]))),this.gradientMeshBuffer=this.mustCreateBuffer(),this.gradientMeshVao=this.createVertexArray(),r.bindVertexArray(this.gradientMeshVao),r.bindBuffer(r.ARRAY_BUFFER,this.gradientMeshBuffer),r.bufferData(r.ARRAY_BUFFER,e.vertices,r.STATIC_DRAW),r.enableVertexAttribArray(0),r.vertexAttribPointer(0,2,r.FLOAT,!1,24,0),r.enableVertexAttribArray(1),r.vertexAttribPointer(1,4,r.FLOAT,!1,24,8),r.bindVertexArray(null)}let i=r.getParameter(r.MAX_TEXTURE_SIZE),o=Z(t.gradientCount,i);this.gradientTextureWidth=o.width,this.gradientTextureHeight=o.height;let c=[t.gradientMetaA,t.gradientMetaB,t.gradientMetaC,t.gradientMetaD,t.gradientMetaE];for(let e=0;e<this.gradientMetaTextures.length;e+=1)this.uploadFloatDataTexture(this.gradientMetaTextures[e],c[e],t.gradientCount,o);if(r.bindTexture(r.TEXTURE_2D,this.gradientLutTexture),xc(r),t.gradientCount>0){let e=y*t.gradientCount*4,n=new Uint8Array(e);n.set(t.gradientLut.subarray(0,e)),r.texImage2D(r.TEXTURE_2D,0,r.RGBA,y,t.gradientCount,0,r.RGBA,r.UNSIGNED_BYTE,n)}else r.texImage2D(r.TEXTURE_2D,0,r.RGBA,1,1,0,r.RGBA,r.UNSIGNED_BYTE,/* @__PURE__ */ new Uint8Array(4));let l=Z(t.gradientFillPathCount,i),u={pathCount:t.gradientFillPathCount,segmentCount:t.gradientFillSegmentCount,pathMetaA:t.gradientFillPathMetaA,pathMetaB:t.gradientFillPathMetaB,segmentsA:t.gradientFillSegmentsA,segmentsB:t.gradientFillSegmentsB},d=v(u,s(u),i),f=Z(d.texels,i);this.gradientFillBandBase=d.bandBase,this.gradientFillBandEntries=d.bandEntries,this.gradientFillCellBase=d.cellBase,this.gradientFillPathTextureWidth=l.width,this.gradientFillPathTextureHeight=l.height,this.gradientFillSegmentTextureWidth=f.width,this.gradientFillSegmentTextureHeight=f.height;let p=[t.gradientFillPathMetaA,t.gradientFillPathMetaB,t.gradientFillPathMetaC,t.gradientFillPaintMeta];for(let e=0;e<p.length;e+=1)this.uploadFloatDataTexture(this.gradientFillTextures[e],p[e],t.gradientFillPathCount,l);this.uploadFloatDataTexture(this.gradientFillTextures[4],d.dataA,d.texels,f),this.uploadFloatDataTexture(this.gradientFillTextures[5],d.dataB,d.dataB.length/4,f);let m=Z(t.gradientStrokeRunCount,i),h=Z(t.gradientStrokeSegmentCount,i);this.gradientStrokeRunTextureWidth=m.width,this.gradientStrokeRunTextureHeight=m.height,this.gradientStrokeSegmentTextureWidth=h.width,this.gradientStrokeSegmentTextureHeight=h.height,this.uploadFloatDataTexture(this.gradientStrokeTextures[0],t.gradientStrokeRunMetaA,t.gradientStrokeRunCount,m);let g=[t.gradientStrokeEndpoints,t.gradientStrokePrimitiveMeta,t.gradientStrokePrimitiveBounds,t.gradientStrokeStyles];for(let e=0;e<g.length;e+=1)this.uploadFloatDataTexture(this.gradientStrokeTextures[e+1],g[e],t.gradientStrokeSegmentCount,h);this.orderedGradientPaintCommands=x(this.getSceneRasterLayers(e),t),this.gradientPaintRequiresDirectRendering=a(this.orderedGradientPaintCommands)}uploadFloatDataTexture(e,t,n,r,i){let a=this.gl,o=new Float32Array(r.width*r.height*4);o.set(t.subarray(0,Math.min(t.length,Math.max(0,n)*4))),i&&o.set(i,Math.max(0,n)*4),a.bindTexture(a.TEXTURE_2D,e),X(a),a.texImage2D(a.TEXTURE_2D,0,a.RGBA32F,r.width,r.height,0,a.RGBA,a.FLOAT,o)}uploadFillPaths(e){let t=this.gl,n=t.getParameter(t.MAX_TEXTURE_SIZE),r=Z(e.fillPathCount,n),i=we(e);this.fillCoverageMetadata=e.fillPathCount>0?i:null;let a=v({...g(e),pathMetaA:i.pathMetaA,pathMetaB:i.pathMetaB},c(e),n),o=Z(a.texels,n);this.fillBandBase=a.bandBase,this.fillBandEntries=a.bandEntries,this.fillCellBase=a.cellBase,this.fillPathMetaTextureWidth=r.width,this.fillPathMetaTextureHeight=r.height,this.fillSegmentTextureWidth=o.width,this.fillSegmentTextureHeight=o.height;let s=r.width*r.height,l=o.width*o.height,u=new Float32Array(s*4);u.set(i.pathMetaA);let d=new Float32Array(s*4);d.set(i.pathMetaB);let f=new Float32Array(s*4);f.set(i.pathMetaC);let p=new Float32Array(l*4);p.set(a.dataA);let m=new Float32Array(l*4);return m.set(a.dataB),t.bindTexture(t.TEXTURE_2D,this.fillPathMetaTextureA),X(t),t.texImage2D(t.TEXTURE_2D,0,t.RGBA32F,this.fillPathMetaTextureWidth,this.fillPathMetaTextureHeight,0,t.RGBA,t.FLOAT,u),t.bindTexture(t.TEXTURE_2D,this.fillPathMetaTextureB),X(t),t.texImage2D(t.TEXTURE_2D,0,t.RGBA32F,this.fillPathMetaTextureWidth,this.fillPathMetaTextureHeight,0,t.RGBA,t.FLOAT,d),t.bindTexture(t.TEXTURE_2D,this.fillPathMetaTextureC),X(t),t.texImage2D(t.TEXTURE_2D,0,t.RGBA32F,this.fillPathMetaTextureWidth,this.fillPathMetaTextureHeight,0,t.RGBA,t.FLOAT,f),t.bindTexture(t.TEXTURE_2D,this.fillSegmentTextureA),X(t),t.texImage2D(t.TEXTURE_2D,0,t.RGBA32F,this.fillSegmentTextureWidth,this.fillSegmentTextureHeight,0,t.RGBA,t.FLOAT,p),t.bindTexture(t.TEXTURE_2D,this.fillSegmentTextureB),X(t),t.texImage2D(t.TEXTURE_2D,0,t.RGBA32F,this.fillSegmentTextureWidth,this.fillSegmentTextureHeight,0,t.RGBA,t.FLOAT,m),{pathMetaTextureWidth:this.fillPathMetaTextureWidth,pathMetaTextureHeight:this.fillPathMetaTextureHeight,segmentTextureWidth:this.fillSegmentTextureWidth,segmentTextureHeight:this.fillSegmentTextureHeight}}uploadSegments(e){let t=this.uploadStrokeTextureSet(e,{textureA:this.segmentTextureA,textureB:this.segmentTextureB,textureC:this.segmentTextureC,textureD:this.segmentTextureD});return this.segmentTextureWidth=t.textureWidth,this.segmentTextureHeight=t.textureHeight,{textureWidth:this.segmentTextureWidth,textureHeight:this.segmentTextureHeight,maxTextureSize:t.maxTextureSize}}uploadStrokeTextureSet(e,t){let n=this.gl,r=n.getParameter(n.MAX_TEXTURE_SIZE),i=Math.max(0,e.count|0),a=Q(Math.ceil(Math.sqrt(i)),1,r),o=Math.max(1,Math.ceil(i/a));if(o>r)throw Error(`Segment texture exceeds GPU limits for this browser/GPU.`);for(let[r,i]of[[t.textureA,`endpoints`],[t.textureB,`primitiveMeta`],[t.textureC,`styles`],[t.textureD,`primitiveBounds`]]){n.bindTexture(n.TEXTURE_2D,r),X(n),n.texImage2D(n.TEXTURE_2D,0,n.RGBA32F,a,o,0,n.RGBA,n.FLOAT,null);for(let t of _e(e,i,a))n.texSubImage2D(n.TEXTURE_2D,0,0,t.y,t.width,t.height,n.RGBA,n.FLOAT,t.data)}return{textureWidth:a,textureHeight:o,maxTextureSize:r}}rebuildVectorLod(e){return this.mixedVectorBatches=null,this.mixedVectorGpu&&(this.mixedVectorGpu.revision=-1),cs(this.vectorLodMode,`webgl`,e.segmentCount)?(this.vectorLodRuntime=gs(e)??new ss(e),this.vectorLodRuntime.setForceExact(this.primitiveColors?.has(`stroke`)??!1)):this.vectorLodRuntime=null,this.vectorLodStats=null,this.orderedBatches=e.drawRuns?new Hi(e,this.vectorLodRuntime&&this.vectorLodRuntime.levels.length>1?this.vectorLodRuntime:null):null,this.orderedRunCuller=this.thumbnailMode?null:this.orderedBatches?.createRunCuller()??null,this.orderedTextLod&&this.orderedRunCuller?.includeTextLod(this.orderedTextLod.data),this.runLookup=Zr(e),this.orderedBatches?.setColorCommutationEnabled(!this.primitiveColors?.has(`stroke`)&&!this.primitiveColors?.has(`fill`)&&!this.primitiveColors?.has(`text`)),this.orderedBatches?.setBlackDarkenSourceOverEnabled(this.vectorOverrideOpacity===0||this.vectorOverrideColor.every(e=>e===0)),this.orderedBatches&&!this.orderedInstanceBuffer&&(this.orderedInstanceBuffer=this.mustCreateBuffer()),this.uploadSegments(this.orderedBatches?.strokeRecords??pe(e)),!this.vectorLodRuntime||this.vectorLodRuntime.levels.length<=1?(this.destroyVectorLodResources(),this.vectorLodRuntime=null,!1):(this.uploadVectorLodLevels(),this.vectorLodRuntime.levels.length>1)}uploadVectorLodLevels(){if(this.destroyVectorLodResources(),this.vectorLodRuntime){if(this.orderedBatches){this.vectorLodLevels.push({textureA:this.segmentTextureA,textureB:this.segmentTextureB,textureC:this.segmentTextureC,textureD:this.segmentTextureD,textureWidth:this.segmentTextureWidth,textureHeight:this.segmentTextureHeight,ownsTextures:!1,visibleSegmentIdBuffer:this.orderedInstanceBuffer,visibleSegmentIdsFloat:/* @__PURE__ */ new Float32Array});return}for(let e=0;e<this.vectorLodRuntime.levels.length;e+=1){let t=this.vectorLodRuntime.levels[e],n=this.mustCreateBuffer(),r=/* @__PURE__ */ new Float32Array;if(e===0){this.vectorLodLevels.push({textureA:this.segmentTextureA,textureB:this.segmentTextureB,textureC:this.segmentTextureC,textureD:this.segmentTextureD,textureWidth:this.segmentTextureWidth,textureHeight:this.segmentTextureHeight,ownsTextures:!1,visibleSegmentIdBuffer:n,visibleSegmentIdsFloat:r});continue}let i=this.mustCreateTexture(),a=this.mustCreateTexture(),o=this.mustCreateTexture(),s=this.mustCreateTexture(),c=this.uploadStrokeTextureSet(pe(zi(t)),{textureA:i,textureB:a,textureC:o,textureD:s});this.vectorLodLevels.push({textureA:i,textureB:a,textureC:o,textureD:s,textureWidth:c.textureWidth,textureHeight:c.textureHeight,ownsTextures:!0,visibleSegmentIdBuffer:n,visibleSegmentIdsFloat:r})}}}destroyVectorLodResources(){for(let e of this.vectorLodLevels)e.visibleSegmentIdBuffer!==this.orderedInstanceBuffer&&this.gl.deleteBuffer(e.visibleSegmentIdBuffer),e.ownsTextures&&(this.gl.deleteTexture(e.textureA),this.gl.deleteTexture(e.textureB),this.gl.deleteTexture(e.textureC),this.gl.deleteTexture(e.textureD));this.vectorLodLevels=[],this.vectorLodStats=null}uploadTextData(e,t){let n=this.gl,r=n.getParameter(n.MAX_TEXTURE_SIZE),i=t?.combinedInstanceCount??e.textInstanceCount,a=Math.floor((e.textClipRects?.length??0)/4),o=e.textGlyphCount+ +!!t+a,s=e.textGlyphSegmentCount+(t?4:0),c=Z(i,r),l=Z(o,r),u=Z(s,r);this.textInstanceTextureWidth=c.width,this.textInstanceTextureHeight=c.height,this.textGlyphMetaTextureWidth=l.width,this.textGlyphMetaTextureHeight=l.height,this.textGlyphSegmentTextureWidth=u.width,this.textGlyphSegmentTextureHeight=u.height;let d=c.width*c.height,f=l.width*l.height,p=u.width*u.height,m=new Float32Array(d*4),h=new Float32Array(d*4),g=new Float32Array(d*4),_=new Float32Array(f*4),v=new Float32Array(f*4),y=new Float32Array(f*4),b=performance.now(),x=this.thumbnailMode?null:Do(e,r);this.recordPerformanceTransition(`pageSwap.glyphAtlas`,performance.now()-b),x?(y.set(x.glyphUvRects),this.textRasterAtlasWidth=x.width,this.textRasterAtlasHeight=x.height):(this.textRasterAtlasWidth=1,this.textRasterAtlasHeight=1);let S=new Float32Array(p*4),C=new Float32Array(p*4);t?ma(e,t,{textInstanceA:m,textInstanceB:h,textInstanceC:g,textGlyphMetaA:_,textGlyphMetaB:v,textGlyphSegmentsA:S,textGlyphSegmentsB:C}):(m.set(e.textInstanceA),h.set(e.textInstanceB),g.set(e.textInstanceC),_.set(e.textGlyphMetaA),v.set(e.textGlyphMetaB),S.set(e.textGlyphSegmentsA),C.set(e.textGlyphSegmentsB));let w=e.textGlyphCount+ +!!t;if(Ea(w,_,v,S,C),a>0){_.set(e.textClipRects,w*4);for(let t=0;t<e.textInstanceCount;t+=1){let e=t*4+3,n=h[e];n>0&&(h[e]=w+n)}}let T=Ec(g,d);n.bindTexture(n.TEXTURE_2D,this.textInstanceTextureA),X(n),n.texImage2D(n.TEXTURE_2D,0,n.RGBA32F,this.textInstanceTextureWidth,this.textInstanceTextureHeight,0,n.RGBA,n.FLOAT,m),n.bindTexture(n.TEXTURE_2D,this.textInstanceTextureB),X(n),n.texImage2D(n.TEXTURE_2D,0,n.RGBA32F,this.textInstanceTextureWidth,this.textInstanceTextureHeight,0,n.RGBA,n.FLOAT,h),n.bindTexture(n.TEXTURE_2D,this.textInstanceTextureC),Sc(n),n.texImage2D(n.TEXTURE_2D,0,n.RGBA8,this.textInstanceTextureWidth,this.textInstanceTextureHeight,0,n.RGBA,n.UNSIGNED_BYTE,T),n.bindTexture(n.TEXTURE_2D,this.textGlyphMetaTextureA),X(n),n.texImage2D(n.TEXTURE_2D,0,n.RGBA32F,this.textGlyphMetaTextureWidth,this.textGlyphMetaTextureHeight,0,n.RGBA,n.FLOAT,_),n.bindTexture(n.TEXTURE_2D,this.textGlyphMetaTextureB),X(n),n.texImage2D(n.TEXTURE_2D,0,n.RGBA32F,this.textGlyphMetaTextureWidth,this.textGlyphMetaTextureHeight,0,n.RGBA,n.FLOAT,v),n.bindTexture(n.TEXTURE_2D,this.textGlyphRasterMetaTexture),X(n),n.texImage2D(n.TEXTURE_2D,0,n.RGBA32F,this.textGlyphMetaTextureWidth,this.textGlyphMetaTextureHeight,0,n.RGBA,n.FLOAT,y),n.bindTexture(n.TEXTURE_2D,this.textGlyphSegmentTextureA),X(n),n.texImage2D(n.TEXTURE_2D,0,n.RGBA32F,this.textGlyphSegmentTextureWidth,this.textGlyphSegmentTextureHeight,0,n.RGBA,n.FLOAT,S),n.bindTexture(n.TEXTURE_2D,this.textGlyphSegmentTextureB),X(n),n.texImage2D(n.TEXTURE_2D,0,n.RGBA32F,this.textGlyphSegmentTextureWidth,this.textGlyphSegmentTextureHeight,0,n.RGBA,n.FLOAT,C),n.bindTexture(n.TEXTURE_2D,this.textRasterAtlasTexture),Tc(n),n.pixelStorei(n.UNPACK_ALIGNMENT,1);let D=E(x?.alpha??new Uint8Array([0]),this.textRasterAtlasWidth,this.textRasterAtlasHeight);for(let e=0;e<D.length;e+=1){let t=D[e];n.texImage2D(n.TEXTURE_2D,e,n.R8,t.width,t.height,0,n.RED,n.UNSIGNED_BYTE,t.data)}return n.texParameteri(n.TEXTURE_2D,n.TEXTURE_BASE_LEVEL,0),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_MAX_LEVEL,D.length-1),n.pixelStorei(n.UNPACK_ALIGNMENT,4),{instanceTextureWidth:this.textInstanceTextureWidth,instanceTextureHeight:this.textInstanceTextureHeight,glyphMetaTextureWidth:this.textGlyphMetaTextureWidth,glyphMetaTextureHeight:this.textGlyphMetaTextureHeight,glyphSegmentTextureWidth:this.textGlyphSegmentTextureWidth,glyphSegmentTextureHeight:this.textGlyphSegmentTextureHeight}}buildSegmentBounds(e){if(e.drawRuns){this.segmentMinX=/* @__PURE__ */ new Float32Array,this.segmentMinY=/* @__PURE__ */ new Float32Array,this.segmentMaxX=/* @__PURE__ */ new Float32Array,this.segmentMaxY=/* @__PURE__ */ new Float32Array;return}this.segmentMinX.length<this.segmentCount&&(this.segmentMinX=new Float32Array(this.segmentCount),this.segmentMinY=new Float32Array(this.segmentCount),this.segmentMaxX=new Float32Array(this.segmentCount),this.segmentMaxY=new Float32Array(this.segmentCount));for(let t=0;t<this.segmentCount;t+=1){let n=t*4,r=t*4,i=e.styles[r]+.35;this.segmentMinX[t]=e.primitiveBounds[n]-i,this.segmentMinY[t]=e.primitiveBounds[n+1]-i,this.segmentMaxX[t]=e.primitiveBounds[n+2]+i,this.segmentMaxY[t]=e.primitiveBounds[n+3]+i}}initializeGeometry(){let e=this.gl;e.bindBuffer(e.ARRAY_BUFFER,this.cornerBuffer);let t=new Float32Array([-1,-1,1,-1,-1,1,1,1]);e.bufferData(e.ARRAY_BUFFER,t,e.STATIC_DRAW),e.bindVertexArray(this.segmentVao),e.bindBuffer(e.ARRAY_BUFFER,this.cornerBuffer),e.enableVertexAttribArray(0),e.vertexAttribPointer(0,2,e.FLOAT,!1,8,0),e.vertexAttribDivisor(0,0),e.bindBuffer(e.ARRAY_BUFFER,this.allSegmentIdBuffer),e.enableVertexAttribArray(1),e.vertexAttribPointer(1,1,e.FLOAT,!1,4,0),e.vertexAttribDivisor(1,1),e.bindVertexArray(this.fillVao),e.bindBuffer(e.ARRAY_BUFFER,this.cornerBuffer),e.enableVertexAttribArray(0),e.vertexAttribPointer(0,2,e.FLOAT,!1,8,0),e.vertexAttribDivisor(0,0),e.bindBuffer(e.ARRAY_BUFFER,this.allFillPathIdBuffer),e.enableVertexAttribArray(3),e.vertexAttribPointer(3,1,e.FLOAT,!1,4,0),e.vertexAttribDivisor(3,1),e.bindVertexArray(this.textVao),e.bindBuffer(e.ARRAY_BUFFER,this.cornerBuffer),e.enableVertexAttribArray(0),e.vertexAttribPointer(0,2,e.FLOAT,!1,8,0),e.vertexAttribDivisor(0,0),e.bindBuffer(e.ARRAY_BUFFER,this.allTextInstanceIdBuffer),e.enableVertexAttribArray(2),e.vertexAttribPointer(2,1,e.FLOAT,!1,4,0),e.vertexAttribDivisor(2,1),e.bindVertexArray(this.blitVao),e.bindBuffer(e.ARRAY_BUFFER,this.cornerBuffer),e.enableVertexAttribArray(0),e.vertexAttribPointer(0,2,e.FLOAT,!1,8,0),e.vertexAttribDivisor(0,0);for(let[t,n]of[[this.pageBackgroundVao,this.pageBackgroundBuffer],[this.highlightOthersVao,this.highlightOthersBuffer],[this.highlightCurrentVao,this.highlightCurrentBuffer],[this.highlightSelectionVao,this.highlightSelectionBuffer]])t&&(e.bindVertexArray(t),e.bindBuffer(e.ARRAY_BUFFER,this.cornerBuffer),e.enableVertexAttribArray(0),e.vertexAttribPointer(0,2,e.FLOAT,!1,8,0),e.vertexAttribDivisor(0,0),e.bindBuffer(e.ARRAY_BUFFER,n),e.enableVertexAttribArray(1),e.vertexAttribPointer(1,4,e.FLOAT,!1,t===this.pageBackgroundVao?20:16,0),e.vertexAttribDivisor(1,1));e.bindVertexArray(this.pageBackgroundVao),e.bindBuffer(e.ARRAY_BUFFER,this.pageBackgroundBuffer),e.enableVertexAttribArray(4),e.vertexAttribPointer(4,1,e.FLOAT,!1,20,16),e.vertexAttribDivisor(4,1),e.bindVertexArray(null)}initializeState(){this.ensureRenderState()}ensureRenderState(){let e=this.gl;e.disable(e.DEPTH_TEST),e.disable(e.CULL_FACE),e.disable(e.SCISSOR_TEST),e.colorMask(!0,!0,!0,!0),e.enable(e.BLEND),e.blendEquationSeparate(e.FUNC_ADD,e.FUNC_ADD),e.blendFuncSeparate(e.SRC_ALPHA,e.ONE_MINUS_SRC_ALPHA,e.ONE,e.ONE_MINUS_SRC_ALPHA)}uploadPageBackgroundTexture(){let e=this.gl,t=this.pageBackgroundColor,n=new Uint8Array([Math.round(t[0]*255),Math.round(t[1]*255),Math.round(t[2]*255),Math.round(t[3]*255)]);e.bindTexture(e.TEXTURE_2D,this.pageBackgroundTexture),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.NEAREST),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.NEAREST),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE),e.texImage2D(e.TEXTURE_2D,0,e.RGBA,1,1,0,e.RGBA,e.UNSIGNED_BYTE,n),e.bindTexture(e.TEXTURE_2D,null)}clientToScenePoint(e,t){return this.isDisposed?null:this.clientToWorld(e,t)}sceneToClientPoint(e,t){if(this.isDisposed)return null;let n=this.resolveInteractionViewportRect(),r=this.resolveClientToPixelScale(n);if(r.x===0||r.y===0)return null;let i=(e-this.cameraCenterX)*this.zoom+this.canvas.width*.5,a=(t-this.cameraCenterY)*this.zoom+this.canvas.height*.5;return{x:n.left+i/r.x,y:n.bottom-a/r.y}}clientToWorld(e,t){return this.clientToWorldAt(e,t,this.cameraCenterX,this.cameraCenterY,this.zoom)}clientToWorldAt(e,t,n,r,i){let a=this.resolveInteractionViewportRect(),o=this.resolveClientToPixelScale(a),s=(e-a.left)*o.x,c=(a.bottom-t)*o.y;return{x:(s-this.canvas.width*.5)/i+n,y:(c-this.canvas.height*.5)/i+r}}syncCameraTargetsToCurrent(){this.targetCameraCenterX=this.cameraCenterX,this.targetCameraCenterY=this.cameraCenterY,this.targetZoom=this.zoom,this.lastCameraAnimationTimeMs=0,this.hasZoomAnchor=!1}updatePanReleaseVelocitySample(e){if(!this.isPanInteracting){this.lastPanFrameTimeMs=0;return}if(this.lastPanFrameTimeMs>0){let t=e-this.lastPanFrameTimeMs;if(t>.1){let n=this.cameraCenterX-this.lastPanFrameCameraX,r=this.cameraCenterY-this.lastPanFrameCameraY,i=n*1e3/t,a=r*1e3/t,o=Math.hypot(i,a);if(Number.isFinite(o)&&o>=5){if(o>fc){let e=fc/o;i*=e,a*=e}this.panVelocityWorldX=i,this.panVelocityWorldY=a,this.lastPanVelocityUpdateTimeMs=e}}}this.lastPanFrameCameraX=this.cameraCenterX,this.lastPanFrameCameraY=this.cameraCenterY,this.lastPanFrameTimeMs=e}updateCameraWithDamping(e){let t=Math.abs(this.targetCameraCenterX-this.cameraCenterX)>uc||Math.abs(this.targetCameraCenterY-this.cameraCenterY)>uc,n=Math.abs(this.targetZoom-this.zoom)>dc;if(!t&&!n)return this.hasZoomAnchor=!1,this.lastCameraAnimationTimeMs=e,!1;this.lastCameraAnimationTimeMs<=0&&(this.lastCameraAnimationTimeMs=e-16);let r=Q(e-this.lastCameraAnimationTimeMs,0,64);this.lastCameraAnimationTimeMs=e;let i=r/1e3,a=1-Math.exp(-24*i),o=1-Math.exp(-24*i);if(n&&(this.zoom+=(this.targetZoom-this.zoom)*o,Math.abs(this.targetZoom-this.zoom)<=dc&&(this.zoom=this.targetZoom)),this.hasZoomAnchor){let e=this.computeCameraCenterForAnchor(this.zoomAnchorClientX,this.zoomAnchorClientY,this.zoomAnchorWorldX,this.zoomAnchorWorldY,this.zoom),r=this.computeCameraCenterForAnchor(this.zoomAnchorClientX,this.zoomAnchorClientY,this.zoomAnchorWorldX,this.zoomAnchorWorldY,this.targetZoom);this.cameraCenterX=e.x,this.cameraCenterY=e.y,this.targetCameraCenterX=r.x,this.targetCameraCenterY=r.y,n||(this.hasZoomAnchor=!1),t=!1}else t&&(this.cameraCenterX+=(this.targetCameraCenterX-this.cameraCenterX)*a,this.cameraCenterY+=(this.targetCameraCenterY-this.cameraCenterY)*a,Math.abs(this.targetCameraCenterX-this.cameraCenterX)<=uc&&(this.cameraCenterX=this.targetCameraCenterX),Math.abs(this.targetCameraCenterY-this.cameraCenterY)<=uc&&(this.cameraCenterY=this.targetCameraCenterY));return this.needsVisibleSetUpdate=!0,t=Math.abs(this.targetCameraCenterX-this.cameraCenterX)>uc||Math.abs(this.targetCameraCenterY-this.cameraCenterY)>uc,n=Math.abs(this.targetZoom-this.zoom)>dc,t||n}computeCameraCenterForAnchor(e,t,n,r,i){let a=this.resolveInteractionViewportRect(),o=this.resolveClientToPixelScale(a),s=(e-a.left)*o.x,c=(a.bottom-t)*o.y;return{x:n-(s-this.canvas.width*.5)/i,y:r-(c-this.canvas.height*.5)/i}}resolveInteractionViewportRect(){let e=this.interactionViewportProvider?.();if(e)return e;if(!(`getBoundingClientRect`in this.canvas))throw Error(`Offscreen rendering has no interaction viewport.`);return this.canvas.getBoundingClientRect()}resolveClientToPixelScale(e){let t=e??this.resolveInteractionViewportRect(),n=Math.max(window.devicePixelRatio||1,1e-6),r=t.width>1e-6?this.canvas.width/t.width:n,i=t.height>1e-6?this.canvas.height/t.height:n;return{x:Math.max(1e-6,r),y:Math.max(1e-6,i)}}createProgram(e,t){let n=this.gl,r=this.compileShader(n.VERTEX_SHADER,Yr(e)),i=null,a=null;try{if(i=this.compileShader(n.FRAGMENT_SHADER,Yr(t)),a=n.createProgram(),!a)throw Error(`Unable to create WebGL program.`);if(n.attachShader(a,r),n.attachShader(a,i),n.linkProgram(a),!n.getProgramParameter(a,n.LINK_STATUS))throw Error(`Program link failed: ${n.getProgramInfoLog(a)||`Unknown linker error.`}`);return a}catch(e){throw n.deleteProgram(a),e}finally{n.deleteShader(r),i&&n.deleteShader(i)}}compileShader(e,t){let n=this.gl.createShader(e);if(!n)throw Error(`Unable to create shader.`);if(this.gl.shaderSource(n,t),this.gl.compileShader(n),!this.gl.getShaderParameter(n,this.gl.COMPILE_STATUS)){let e=this.gl.getShaderInfoLog(n)||`Unknown shader compiler error.`;throw this.gl.deleteShader(n),Error(`Shader compilation failed: ${e}`)}return n}createVertexArray(){let e=this.gl.createVertexArray();if(!e)throw Error(`Unable to create VAO.`);return e}mustCreateBuffer(){let e=this.gl.createBuffer();if(!e)throw Error(`Unable to create WebGL buffer.`);return e}mustCreateTexture(){let e=this.gl.createTexture();if(!e)throw Error(`Unable to create WebGL texture.`);return e}mustGetUniformLocation(e,t){let n=this.gl.getUniformLocation(e,t);if(!n)throw Error(`Missing uniform: ${t}`);return n}mustGetUniformMap(e,t){let n={};for(let r of t)n[r]=this.mustGetUniformLocation(e,r);return n}};function X(e){e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.NEAREST),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.NEAREST),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE)}function xc(e){e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE)}function Sc(e){e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.NEAREST),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.NEAREST),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE)}function Cc(e){e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE)}function wc(e,t){e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,t===!1?e.NEAREST:e.LINEAR_MIPMAP_LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,t===!1?e.NEAREST:e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE)}function Tc(e){wc(e);let t=e.getExtension(`EXT_texture_filter_anisotropic`);if(!t)return;let n=Number(e.getParameter(t.MAX_TEXTURE_MAX_ANISOTROPY_EXT));Number.isFinite(n)&&n>1&&e.texParameterf(e.TEXTURE_2D,t.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(16,n))}function Ec(e,t){let n=new Uint8Array(t*4),r=Math.min(e.length,n.length);for(let t=0;t<r;t+=1)n[t]=Math.round(Q(e[t],0,1)*255);return n}function Z(e,t){let n=Math.max(1,e),r=Q(Math.ceil(Math.sqrt(n)),1,t),i=Math.max(1,Math.ceil(n/r));if(i>t)throw Error(`Data texture exceeds GPU limits for this browser/GPU.`);return{width:r,height:i}}function Dc(e,t){return t>=1&&Math.max(1,e)/t<=t}function Oc(e){return e.pageRects instanceof Float32Array&&e.pageRects.length>=4?new Float32Array(e.pageRects):new Float32Array([e.pageBounds.minX,e.pageBounds.minY,e.pageBounds.maxX,e.pageBounds.maxY])}function kc(e,t,n){let r=Math.max(1,Math.floor(t.length/4)),i=r*2,a=Math.max(0,n|0);if(e.pageTextRanges instanceof Uint32Array&&e.pageTextRanges.length>=i){let t=new Uint32Array(i),n=0;for(let i=0;i<r;i+=1){let r=i*2,o=Q(Math.trunc(e.pageTextRanges[r]),n,a),s=Q(Math.trunc(e.pageTextRanges[r+1]),0,a-o);t[r]=o,t[r+1]=s,n=o+s}return t}let o=new Uint32Array(i);o[0]=0,o[1]=a;for(let e=1;e<r;e+=1){let t=e*2;o[t]=a,o[t+1]=0}return o}function Q(e,t,n){return e<t?t:e>n?n:e}function $(e,t){return e<0?0:e>=t?t-1:e}var Ac=class extends Error{code=`thumbnail.webgl-unavailable`;constructor(e){super(`WebGL2 thumbnail rendering is unavailable in this environment.`,e===void 0?void 0:{cause:e}),this.name=`ThumbnailWebGlUnavailableError`}},jc=class{canvas=null;renderer=null;lifetime=new AbortController;pending=Promise.resolve();render(e,t,n){let r=n?AbortSignal.any([n,this.lifetime.signal]):this.lifetime.signal;r.throwIfAborted();let i=this.pending.then(()=>this.renderPage(e,t,r));return this.pending=i.then(()=>{},()=>{}),ue(i,r)}close(){this.lifetime.signal.aborted||(this.lifetime.abort(new DOMException(`The thumbnail renderer is closed.`,`AbortError`)),this.releaseRenderer())}async renderPage(e,t,n){if(n.throwIfAborted(),t.backend===`canvas2d`)throw Error(`Canvas2D thumbnails require a PDF page; compiled HEP scenes use WebGL2.`);let r=e.pageBounds,i=R(r.maxX-r.minX,r.maxY-r.minY,t.maxDimension);if(!Number.isSafeInteger(i.width*i.height*4))throw RangeError(`Thumbnail pixel dimensions exceed safe integer limits.`);let a=Mc(e,.5/Math.min(i.width/(r.maxX-r.minX),i.height/(r.maxY-r.minY))),o=Pc(a,t.optionalContent),s=Fc(t.background),c=Fc(t.vectorOverride??[0,0,0,0]),l=null,u=[];try{await ue(new Promise(e=>setTimeout(e,0)),n);let e=!this.renderer,d=performance.now();this.ensureRenderer(),e&&u.push({stage:`factory`,durationMs:performance.now()-d});let f=this.canvas,p=this.renderer;f.width=i.width,f.height=i.height;let m=performance.now();p.setScene(a),p.setPageBackgroundColor(...s),p.setVectorColorOverride(...c),p.setOptionalContentVisibility(o);let h=performance.now()-m;if(a.retainedPages?.length){l=new an(a,async(e,n,r,i)=>{let{renderNativeRetainedCommandSpan:a}=await import(`./pdfWorkerEntry-C2M39atj.js`).then(e=>e.st);return a(e,n,r,i,void 0,void 0,{maxDimension:t.maxDimension})});let e=await l.prepare(o,{signal:n});n.throwIfAborted();let r=performance.now(),i=await p.prepareRasterLayerUpdatesAsync(e.layers);try{n.throwIfAborted(),i.commit(),e.commit()}finally{i.dispose()}h+=performance.now()-r}u.push({stage:`upload`,durationMs:h}),n.throwIfAborted();let g=p.renderThumbnailFrame(r,i.width,i.height,n,(e,t)=>u.push({stage:e,durationMs:t}));return{width:i.width,height:i.height,rgba:g,timings:u}}catch(e){throw this.releaseRenderer(),n.throwIfAborted(),e}finally{l?.dispose()}}ensureRenderer(){if(this.renderer)return;let e,t=[];typeof OffscreenCanvas==`function`&&t.push(()=>new OffscreenCanvas(1,1)),typeof document<`u`&&t.push(()=>document.createElement(`canvas`));for(let n of t){let t=null;try{if(t=n(),!t.getContext(`webgl2`,{antialias:!1,depth:!1,stencil:!1,alpha:!0,premultipliedAlpha:!0,powerPreference:`high-performance`,preserveDrawingBuffer:!1}))throw new Ac}catch(n){e=n,t&&Ic(t);continue}try{let e=new bc(t,{thumbnail:!0});this.canvas=t,this.renderer=e;return}catch(e){throw Ic(t),e}}throw new Ac(e)}releaseRenderer(){let e=this.renderer,t=this.canvas;this.renderer=null,this.canvas=null;try{e?.dispose()}finally{t&&Ic(t)}}};function Mc(e,t){let n=Object.getOwnPropertyDescriptors(e);n.drawRuns={enumerable:!0,configurable:!0,writable:!0,value:e.drawRuns??m(e)},n.pendingPagePreviews={enumerable:!0,configurable:!0,writable:!0,value:void 0};let r=Object.defineProperties({},n);for(let e of[`styles`,`gradientStrokeStyles`]){let n=r[e]?.slice();if(n){r[e]=n;for(let i=0;i<n.length;i+=4)n[i]>0&&n[i]<t&&(n[i]=t,e===`styles`&&(r.maxHalfWidth=Math.max(r.maxHalfWidth,n[i])))}}return Nc(r),r}function Nc(e){let t=/* @__PURE__ */ new Map,n=e.textInstanceB.slice(0,e.textInstanceCount*4),r=0;for(let i=0;i<e.textInstanceCount;i++){let a=i*4+2,o=n[a];if(!Number.isSafeInteger(o)||o<0||o>=e.textGlyphCount)throw RangeError(`Thumbnail text references an invalid glyph.`);let s=t.get(o);if(s===void 0){s=t.size,t.set(o,s);let n=e.textGlyphMetaA[o*4],i=e.textGlyphMetaA[o*4+1];if(!Number.isSafeInteger(n)||!Number.isSafeInteger(i)||n<0||i<0||(n+i)*4>Math.min(e.textGlyphSegmentsA.length,e.textGlyphSegmentsB.length))throw RangeError(`Thumbnail text has an invalid glyph outline range.`);r+=i}n[a]=s}let i=new Float32Array(t.size*4),a=new Float32Array(t.size*4),o=new Float32Array(r*4),s=new Float32Array(r*4),c=0;for(let[n,r]of t){let t=n*4,l=e.textGlyphMetaA[t],u=e.textGlyphMetaA[t+1];i.set(e.textGlyphMetaA.subarray(t,t+4),r*4),i[r*4]=c,a.set(e.textGlyphMetaB.subarray(t,t+4),r*4),o.set(e.textGlyphSegmentsA.subarray(l*4,(l+u)*4),c*4),s.set(e.textGlyphSegmentsB.subarray(l*4,(l+u)*4),c*4),c+=u}e.textInstanceB=n,e.textGlyphCount=t.size,e.textGlyphSegmentCount=r,e.textGlyphMetaA=i,e.textGlyphMetaB=a,e.textGlyphSegmentsA=o,e.textGlyphSegmentsB=s}function Pc(e,t){if(!t||!e.optionalContent)return L(e);let n=new Map(t.layers.map(e=>[e.id,e.visible])),r=Object.getOwnPropertyDescriptors(e);return r.optionalContent={enumerable:!0,configurable:!0,writable:!0,value:{...e.optionalContent,groups:e.optionalContent.groups.map(e=>({...e,defaultVisible:n.get(e.id)??e.defaultVisible}))}},{...L(Object.defineProperties({},r)),revision:t.revision}}function Fc(e){if(e.length!==4||!e.every(e=>Number.isFinite(e)&&e>=0&&e<=1))throw RangeError(`Thumbnail colors require four normalized finite channels.`);return[...e]}function Ic(e){try{e.getContext(`webgl2`)?.getExtension(`WEBGL_lose_context`)?.loseContext()}catch{}finally{e.width=e.height=0}}export{jc as ThumbnailSceneRenderer};
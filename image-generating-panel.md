\# NInfer image panel: the "picture being made" animation, for reuse



This is the same picture UI the NInfer chat page (`/ui/`) uses for \*\*Nano Banana\*\*,

made self-contained so another app, such as a harness plugin, can show exactly the

same thing. It is the video panel's sibling (see `video-generating-panel.md`), with

the same water and a warm amber colour so a picture never looks like a video. It has

four parts:



1\. \*\*The panel:\*\* a crisp rounded sheet drawn with WebGL, square until the picture's

&#x20;  own shape is known.

&#x20;  - Ripples start at uneven times and places and bend everything on the sheet,

&#x20;    its words included.

&#x20;  - Smoke curls under misty glass; a tiny crosshatch turns white where a ripple passes.

&#x20;  - The whole sheet is tinted amber: the same light and dark as the video's, warmed.

&#x20;  - The sheet shows the stage, the time so far and a progress bar.

2\. \*\*The reveal:\*\* when the picture is ready, the sheet takes its shape and a slow

&#x20;  wave from the centre brings it up. The real `<img>` then takes over.

3\. \*\*The picture's tools:\*\* share, copy and download, as round buttons on its top

&#x20;  right (shown on hover; always on touch screens). A click on the picture opens it

&#x20;  large over the page, with a back button and the same tools; Esc or a click beside

&#x20;  it closes it.

4\. \*\*The progress log:\*\* plain-text lines for a log, terminal or "thinking" block.



Everything below is plain JavaScript with no dependencies, written for the browser

(any framework: mount it into a div). The progress log in §4 also works in a

terminal on its own.



Source of truth: `ninfer\_monitor/web/ui-video.js` in the NInfer Monitor repo (the

picture section, `attachImage`, `followImage`, `openViewer`, and `IMAGE\_TINT`).



\---



\## 1. The API it follows (NInfer `/v1/images`, OpenAI Images shape)



```

POST {base}/v1/images/generations   {"model":"Nano Banana","prompt":"...","stream":true,"response\_format":"url"}

POST {base}/v1/images/edits         {"model":"Nano Banana","prompt":"what to change","images":\["data:image/png;base64,..."],"stream":true}

&#x20;                                   (or multipart/form-data: image / image\[] files, prompt, stream)

GET  {base}/v1/images/files/{rel}   -> the picture (image/png ...)

GET  {base}/v1/images/models        -> the image model and which endpoints it has

```



Send `Authorization: Bearer <token>` on every call, the file download included. A

public page cannot show the file by URL, so fetch it as a blob, as below.



\- \*\*Rules:\*\* `n` must be 1. Prompts are at most 8,000 characters. Edits take up to

&#x20; the bot's limit of pictures and no `mask` (describe the change in the prompt).

\- \*\*The prompt:\*\* the monitor adds "Create image: ", "Create an image of " and similar

&#x20; (rotating) to a bare prompt, so "a red fox in snow" works. A prompt that already

&#x20; asks for a picture is sent as it is. Edits get "Edit image: " and similar.

\- \*\*Without `stream`:\*\* one JSON body when the picture is ready:

&#x20; `{"created", "data":\[{"b64\_json"|"url", "revised\_prompt"}], "media\_type"}`.

\- \*\*With `"stream": true`:\*\* Server-Sent Events, one `data:` line per event, each with

&#x20; a `type`:



&#x20; | `type` | Fields | When |

&#x20; |---|---|---|

&#x20; | `image\_generation.progress` | `step` (the bot's line), `elapsed` (s) | as the bot works |

&#x20; | `image\_generation.completed` | `b64\_json`, `url`, `media\_type`, `bytes`, `created\_at`, `seconds`, `revised\_prompt` | once, at the end |

&#x20; | `error` | `error: {message, type, code, hint?}` | instead of `completed` |



&#x20; A `: keep-alive` comment comes every 10 s of silence, so tunnels that drop quiet

&#x20; connections keep this one. A typical picture takes about 25 s; the monitor allows

&#x20; 180 s (Engine settings) before it gives up.



There is no job id to poll. The picture is made and kept even if the caller

disconnects, and it appears in the monitor's Images page.



\---



\## 2. The module: `ninfer-image-panel.js`



```js

// ninfer-image-panel.js -- the NInfer "picture being made" panel, the reveal, the

// picture's tools and viewer, and the progress text. No dependencies.

(function (global) {

&#x20; "use strict";



&#x20; const REVEAL\_MS = 2800;                       // the reveal

&#x20; const TINT = \[1.0, 0.66, 0.36, 0.85];         // amber: rgb, then how much (0 = the video's lilac)

&#x20; const seconds = (ms) => Math.max(0, Math.round(ms / 1000)) + " s";



&#x20; // ---- plain words for the bot's steps --------------------------------------------

&#x20; /\*\* The bot's line as someone watching would say it, and how far along it is (0..1); null to keep the last. \*/

&#x20; function friendlyStep(line) {

&#x20;   const rules = \[

&#x20;     \[/waiting for (its|the|an) (turn|earlier|other)|queue/i, "Waiting for its turn", .05],

&#x20;     \[/Starting (Chrome|headless)|Spawning Chrome|Connecting/i, "Opening the browser", .1],

&#x20;     \[/Opening Gemini|Waiting for Gemini to load|Locating|New chat/i, "Opening Gemini", .2],

&#x20;     \[/Uploading/i, "Sending your picture", .25],

&#x20;     \[/Typing|Submitting/i, "Sending the prompt", .3],

&#x20;     \[/sending the prompt again/i, "Gemini stalled · asking again", .35],

&#x20;     \[/Waiting for (image generation|the edited image)|Still generating/i, "Waiting for Gemini", .4],

&#x20;     \[/Creating the image/i, "Creating the image", .65],

&#x20;     \[/Image detected|Downloading|Download complete/i, "Saving the picture", .9],

&#x20;     \[/SynthID|clean/i, "Finishing the picture", .95],

&#x20;   ];

&#x20;   for (const \[pattern, words, at] of rules) if (pattern.test(line)) return \[words, at];

&#x20;   return null;

&#x20; }



&#x20; // ---- styles ---------------------------------------------------------------------

&#x20; const CSS = `

.nm-gen{position:relative;width:100%;max-width:520px;aspect-ratio:1/1;border-radius:16px;overflow:hidden;isolation:isolate;

&#x20; background:radial-gradient(120% 95% at 50% 0%,#b39a86 0%,#86695a 52%,#5f4a40 100%);box-shadow:0 1px 0 rgba(255,255,255,.06),0 8px 30px rgba(0,0,0,.35);

&#x20; animation:nm-gen-in .35s cubic-bezier(.2,.8,.2,1) both}

@keyframes nm-gen-in{from{opacity:0;transform:translateY(6px) scale(.985)}}

.nm-gen canvas{position:absolute;inset:0;width:100%;height:100%;display:block}

.nm-gen-smoke{position:absolute;inset:0;background:radial-gradient(ellipse 58% 55% at 50% 50%,rgba(28,18,12,.85),rgba(28,18,12,.35) 60%,transparent 100%);

&#x20; box-shadow:inset 0 0 40px rgba(255,220,180,.4)}

.nm-gen-mid{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:16px;text-align:center;

&#x20; color:rgba(246,244,255,.95);text-shadow:0 1px 14px rgba(0,0,0,.55);font:500 13px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif}

.nm-gen-icon{font-size:18px;opacity:.85}

.nm-gen-pct{font:300 30px/1.1 system-ui,-apple-system,"Segoe UI",sans-serif;font-variant-numeric:tabular-nums}

.nm-gen-stage{opacity:.85}.nm-gen-time{opacity:.55;font-size:12px;font-variant-numeric:tabular-nums}

.nm-gen.nm-gen-gl .nm-gen-smoke,.nm-gen.nm-gen-gl .nm-gen-mid{visibility:hidden}

.nm-gen-bar{position:absolute;left:0;bottom:0;height:2px;width:0;transition:width .8s ease;

&#x20; background:linear-gradient(90deg,rgba(240,190,140,.7),rgba(255,248,236,.98));box-shadow:0 0 10px rgba(255,214,170,.8)}

.nm-gen.nm-gen-off:not(.nm-gen-gl){filter:grayscale(1) brightness(.72)}

.nm-shot{position:relative;width:100%;max-width:520px;line-height:0}

.nm-shot img{width:100%;border-radius:16px;cursor:zoom-in;display:block}

.nm-tools{position:absolute;top:10px;right:10px;display:flex;gap:6px;opacity:0;transition:opacity .15s}

.nm-shot:hover .nm-tools,.nm-shot:focus-within .nm-tools{opacity:1}

@media (hover:none){.nm-shot .nm-tools{opacity:1}}

.nm-tool{width:34px;height:34px;border-radius:50%;border:0;display:grid;place-items:center;cursor:pointer;color:#fff;

&#x20; background:rgba(20,20,22,.62);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);transition:background .15s}

.nm-tool:hover{background:rgba(20,20,22,.85)}.nm-tool:focus-visible{outline:2px solid #fff;outline-offset:2px}

.nm-viewer{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:72px 24px 24px;

&#x20; background:rgba(24,24,26,.82);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);animation:nm-viewer-in .18s ease both}

.nm-viewer.nm-viewer-out{animation:nm-viewer-out .18s ease both}

@keyframes nm-viewer-in{from{opacity:0}}@keyframes nm-viewer-out{to{opacity:0}}

.nm-viewer img{max-width:100%;max-height:100%;object-fit:contain;box-shadow:0 12px 50px rgba(0,0,0,.5);animation:nm-viewer-zoom .22s cubic-bezier(.2,.8,.2,1) both}

@keyframes nm-viewer-zoom{from{transform:scale(.96);opacity:.4}}

.nm-viewer-top{position:absolute;top:0;left:0;right:0;height:60px;display:flex;align-items:center;justify-content:space-between;padding:0 14px}

.nm-viewer-top .nm-tool{background:transparent}.nm-viewer-top .nm-tool:hover{background:rgba(255,255,255,.12)}

.nm-tools.nm-tools-top{position:static;opacity:1}

@media (prefers-reduced-motion:reduce){.nm-gen{animation:none}}`;



&#x20; function injectStyles() {

&#x20;   if (document.getElementById("nm-img-css")) return;

&#x20;   const style = document.createElement("style");

&#x20;   style.id = "nm-img-css";

&#x20;   style.textContent = CSS;

&#x20;   document.head.appendChild(style);

&#x20; }



&#x20; // ---- the water (WebGL): the video panel's shader, plus the tint ------------------

&#x20; const VS = "attribute vec2 p;varying vec2 v;void main(){v=vec2(p.x\*.5+.5,.5-p.y\*.5);gl\_Position=vec4(p,0.,1.);}";

&#x20; const FS = `precision highp float;

varying vec2 v;uniform float t;uniform vec2 res;uniform sampler2D words;uniform float off;uniform sampler2D frame;uniform float reveal;uniform vec4 tint;

float h(vec2 q){return fract(sin(dot(q,vec2(127.1,311.7)))\*43758.5453);}

float n(vec2 q){vec2 i=floor(q),f=fract(q);f=f\*f\*(3.-2.\*f);

&#x20; return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}

float fbm(vec2 q){float s=0.,a=.5;for(int i=0;i<4;i++){s+=a\*n(q);q=q\*2.03+vec2(1.7,9.2);a\*=.5;}return s;}

void main(){

&#x20; float asp=res.x/res.y;vec2 c=(v-.5)\*vec2(asp,1.);

&#x20; // Ripples, out of step: four sources, each on its own slow cycle.

&#x20; vec2 o=vec2(0.);float crest=0.,wv=0.;

&#x20; for(int i=0;i<4;i++){

&#x20;   float fi=float(i);float P=7.+fi\*2.3+h(vec2(fi,3.1))\*3.;

&#x20;   float tt=t+h(vec2(fi,9.7))\*P;float k=floor(tt/P);float lt=tt-k\*P;

&#x20;   float delay=h(vec2(k,fi+.5))\*P\*.45;lt-=delay;

&#x20;   if(lt>0.){

&#x20;     vec2 src=(vec2(h(vec2(k,fi+1.3)),h(vec2(fi+2.1,k)))-.5)\*vec2(asp\*.75,.7);

&#x20;     if(i==0)src\*=.35;

&#x20;     float speed=.11+.07\*h(vec2(k+4.,fi));float amp=.55+.45\*h(vec2(fi,k+7.));

&#x20;     vec2 dv=c-src;float r=length(dv);float R=lt\*speed;float d=r-R;

&#x20;     float fade=amp\*exp(-R\*1.6)\*smoothstep(0.,.35,lt);

&#x20;     float env=exp(-d\*d\*22.);

&#x20;     float wave=sin(d\*30.)\*env\*fade;wv+=wave;

&#x20;     o+=(dv/max(r,1e-4))\*wave\*.024;

&#x20;     crest+=exp(-d\*d\*700.)\*fade;

&#x20;   }

&#x20; }

&#x20; // The water underneath never quite settles.

&#x20; o+=vec2(sin(c.y\*3.1+t\*.42)+.7\*sin(c.x\*2.3-t\*.31+1.),cos(c.x\*2.7+t\*.37)+.7\*sin(c.y\*3.7-t\*.27))\*.0042;

&#x20; vec2 u=v+o/vec2(asp,1.);vec2 cu=(u-.5)\*vec2(asp,1.);

&#x20; // Misty glass, lighter at the top.

&#x20; vec3 col=mix(vec3(.55,.565,.665),vec3(.26,.275,.35),smoothstep(-.1,1.1,u.y));

&#x20; // Smoke that curls and folds as it drifts.

&#x20; vec2 warp=vec2(fbm(cu\*1.1+vec2(t\*.07,0.)),fbm(cu\*1.1+vec2(3.2,-t\*.06)));

&#x20; float s=fbm(cu\*1.25+warp\*1.35+vec2(t\*.05,-t\*.035));

&#x20; float dark=smoothstep(.4,.95,s+.5-length(cu\*vec2(.8,1.))\*.85);

&#x20; col=mix(col,vec3(.07,.075,.105),dark\*.9);

&#x20; // The mesh: tiny tapered crosses joined into a fine crosshatch, bent with the water.

&#x20; vec2 g=cu\*46.;vec2 f=fract(g)-.5;float px=46./res.y\*.9;

&#x20; float p1=abs(f.x+f.y)\*.7071,p2=abs(f.x-f.y)\*.7071;

&#x20; float w1=mix(.13,.03,smoothstep(0.,.62,p1)),w2=mix(.13,.03,smoothstep(0.,.62,p2));

&#x20; float star=max(1.-smoothstep(w1-px\*.5,w1+px\*.5,p2),1.-smoothstep(w2-px\*.5,w2+px\*.5,p1));

&#x20; float ex0=min(v.x,1.-v.x)\*asp,ey0=min(v.y,1.-v.y);float e0=min(ex0,ey0);

&#x20; // A passing ripple lifts the crosses towards white on its crest.

&#x20; float meshMask=.12+.38\*exp(-e0\*6.)+abs(wv)\*.7;

&#x20; float lift=clamp(1.+3.\*wv,0.,3.4);

&#x20; col+=vec3(.88,.88,1.)\*star\*min(meshMask,1.1)\*(.07+.03\*dark)\*lift;

&#x20; // Light on the ripple crests, and along the edges, blended round the corners.

&#x20; col+=vec3(.86,.83,1.)\*crest\*.2;

&#x20; float ex=min(v.x,1.-v.x)\*asp,ey=min(v.y,1.-v.y);float e=-log(exp(-ex\*14.)+exp(-ey\*14.))/14.;

&#x20; col+=vec3(.92,.9,1.)\*exp(-max(e,0.)\*11.)\*(.24+.08\*sin(t\*1.3));

&#x20; col+=vec3(1.)\*exp(-(1.-v.x)\*asp\*9.)\*(.1+.1\*sin(t\*.7));

&#x20; col+=vec3(.93,.9,1.)\*exp(-v.x\*asp\*10.)\*(.06+.06\*sin(t\*.55+1.));

&#x20; // Pictures get their own colour: the same light and dark, warmed.

&#x20; if(tint.a>0.){float lum=dot(col,vec3(.299,.587,.114));col=mix(col,lum\*tint.rgb\*1.55,tint.a);}

&#x20; // The words, on the same water.

&#x20; vec4 w=texture2D(words,v+o/vec2(asp,1.)\*1.1);

&#x20; col=col\*(1.-w.a)+w.rgb;

&#x20; if(off>.5)col=vec3(dot(col,vec3(.299,.587,.114)))\*.8;

&#x20; // Done: a slow wave from the centre brings up the picture, rippled at first, settling still.

&#x20; if(reveal>0.){float rv=length(c);vec2 dir=c/max(rv,1e-4);float Rv=reveal\*1.5;float dv2=rv-Rv;

&#x20;   float inside=1.-smoothstep(-.22,.03,dv2);

&#x20;   vec2 fo=dir\*sin(dv2\*30.)\*exp(-dv2\*dv2\*22.)\*.024\*(1.-reveal)+o\*(1.-reveal);

&#x20;   vec3 fr=texture2D(frame,v+fo/vec2(asp,1.)).rgb;

&#x20;   col=mix(col,fr,inside);

&#x20;   col+=vec3(.9,.88,1.)\*exp(-dv2\*dv2\*500.)\*.28\*(1.-reveal);}

&#x20; gl\_FragColor=vec4(col,1.);}`;



&#x20; /\*\* Draws the water and the words into `panel`; null where WebGL is not to be had. \*/

&#x20; function startWater(panel, wordsOf, tint) {

&#x20;   let gl = null;

&#x20;   const canvas = document.createElement("canvas");

&#x20;   try { gl = canvas.getContext("webgl", { antialias: false, premultipliedAlpha: false, alpha: false }); } catch (\_) {}

&#x20;   if (!gl) return null;

&#x20;   const shader = (type, src) => {

&#x20;     const sh = gl.createShader(type);

&#x20;     gl.shaderSource(sh, src);

&#x20;     gl.compileShader(sh);

&#x20;     if (!gl.getShaderParameter(sh, gl.COMPILE\_STATUS)) throw new Error(gl.getShaderInfoLog(sh));

&#x20;     return sh;

&#x20;   };

&#x20;   let prog;

&#x20;   try {

&#x20;     prog = gl.createProgram();

&#x20;     gl.attachShader(prog, shader(gl.VERTEX\_SHADER, VS));

&#x20;     gl.attachShader(prog, shader(gl.FRAGMENT\_SHADER, FS));

&#x20;     gl.linkProgram(prog);

&#x20;     if (!gl.getProgramParameter(prog, gl.LINK\_STATUS)) throw new Error(gl.getProgramInfoLog(prog));

&#x20;   } catch (error) { console.warn("\[image panel] water:", error.message); return null; }

&#x20;   gl.useProgram(prog);

&#x20;   gl.bindBuffer(gl.ARRAY\_BUFFER, gl.createBuffer());

&#x20;   gl.bufferData(gl.ARRAY\_BUFFER, new Float32Array(\[-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC\_DRAW);

&#x20;   const loc = gl.getAttribLocation(prog, "p");

&#x20;   gl.enableVertexAttribArray(loc);

&#x20;   gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

&#x20;   const U = (name) => gl.getUniformLocation(prog, name);

&#x20;   const uT = U("t"), uRes = U("res"), uOff = U("off"), uReveal = U("reveal");

&#x20;   gl.uniform4fv(U("tint"), tint || \[0, 0, 0, 0]);

&#x20;   let revealAt = 0, revealDone = null;

&#x20;   // The picture, on texture unit 1; the words on unit 0.

&#x20;   const frameTex = gl.createTexture();

&#x20;   gl.activeTexture(gl.TEXTURE1);

&#x20;   gl.bindTexture(gl.TEXTURE\_2D, frameTex);

&#x20;   for (const \[k, val] of \[\[gl.TEXTURE\_MIN\_FILTER, gl.LINEAR], \[gl.TEXTURE\_MAG\_FILTER, gl.LINEAR],

&#x20;                           \[gl.TEXTURE\_WRAP\_S, gl.CLAMP\_TO\_EDGE], \[gl.TEXTURE\_WRAP\_T, gl.CLAMP\_TO\_EDGE]]) {

&#x20;     gl.texParameteri(gl.TEXTURE\_2D, k, val);

&#x20;   }

&#x20;   gl.uniform1i(U("frame"), 1);

&#x20;   gl.activeTexture(gl.TEXTURE0);

&#x20;   const tex = gl.createTexture();

&#x20;   gl.bindTexture(gl.TEXTURE\_2D, tex);

&#x20;   gl.texParameteri(gl.TEXTURE\_2D, gl.TEXTURE\_MIN\_FILTER, gl.LINEAR);

&#x20;   gl.texParameteri(gl.TEXTURE\_2D, gl.TEXTURE\_MAG\_FILTER, gl.LINEAR);

&#x20;   gl.texParameteri(gl.TEXTURE\_2D, gl.TEXTURE\_WRAP\_S, gl.CLAMP\_TO\_EDGE);

&#x20;   gl.texParameteri(gl.TEXTURE\_2D, gl.TEXTURE\_WRAP\_T, gl.CLAMP\_TO\_EDGE);

&#x20;   gl.uniform1i(U("words"), 0);

&#x20;   const words = document.createElement("canvas");

&#x20;   const ctx = words.getContext("2d");

&#x20;   let drawn = "", off = false, raf = 0;

&#x20;   const start = performance.now();

&#x20;   const still = window.matchMedia \&\& matchMedia("(prefers-reduced-motion: reduce)").matches;



&#x20;   function size() {

&#x20;     const dpr = Math.min(window.devicePixelRatio || 1, 2);

&#x20;     const w = Math.max(1, Math.round(panel.clientWidth \* dpr));

&#x20;     const h = Math.max(1, Math.round(panel.clientHeight \* dpr));

&#x20;     if (canvas.width !== w || canvas.height !== h) {

&#x20;       canvas.width = words.width = w;

&#x20;       canvas.height = words.height = h;

&#x20;       drawn = "";

&#x20;       gl.viewport(0, 0, w, h);

&#x20;     }

&#x20;     return dpr;

&#x20;   }

&#x20;   // The words go to the shader as a texture, so the ripples bend them smoothly.

&#x20;   function paintWords(dpr) {

&#x20;     const lines = wordsOf();

&#x20;     const key = lines.join("\\n") + "|" + canvas.width + "x" + canvas.height;

&#x20;     if (key === drawn) return;

&#x20;     drawn = key;

&#x20;     const W = words.width, H = words.height;

&#x20;     ctx.clearRect(0, 0, W, H);

&#x20;     ctx.textAlign = "center";

&#x20;     ctx.textBaseline = "middle";

&#x20;     ctx.shadowColor = "rgba(0,0,0,.55)";

&#x20;     ctx.shadowBlur = 12 \* dpr;

&#x20;     ctx.shadowOffsetY = dpr;

&#x20;     const font = 'system-ui,-apple-system,"Segoe UI",sans-serif';

&#x20;     const \[icon, pct, stage, time] = lines;

&#x20;     const rows = \[];

&#x20;     if (icon) rows.push(\[icon, `400 ${17 \* dpr}px ${font}`, "rgba(246,244,255,.85)", 26 \* dpr]);

&#x20;     if (pct) rows.push(\[pct, `300 ${30 \* dpr}px ${font}`, "rgba(250,248,255,.97)", 38 \* dpr]);

&#x20;     if (stage) rows.push(\[stage, `500 ${13 \* dpr}px ${font}`, "rgba(246,244,255,.88)", 20 \* dpr]);

&#x20;     if (time) rows.push(\[time, `400 ${12 \* dpr}px ${font}`, "rgba(246,244,255,.55)", 18 \* dpr]);

&#x20;     let y = H / 2 - rows.reduce((sum, row) => sum + row\[3], 0) / 2;

&#x20;     for (const \[text, f, color, lh] of rows) {

&#x20;       ctx.font = f;

&#x20;       ctx.fillStyle = color;

&#x20;       ctx.fillText(text, W / 2, y + lh / 2, W - 32 \* dpr);

&#x20;       y += lh;

&#x20;     }

&#x20;     gl.bindTexture(gl.TEXTURE\_2D, tex);

&#x20;     gl.pixelStorei(gl.UNPACK\_PREMULTIPLY\_ALPHA\_WEBGL, true);

&#x20;     gl.texImage2D(gl.TEXTURE\_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED\_BYTE, words);

&#x20;   }

&#x20;   function frame(now) {

&#x20;     raf = 0;

&#x20;     if (!panel.isConnected) return;          // removed from the page: stops by itself

&#x20;     const dpr = size();

&#x20;     paintWords(dpr);

&#x20;     gl.uniform1f(uT, still ? 0 : (now - start) / 1000);

&#x20;     gl.uniform2f(uRes, canvas.width, canvas.height);

&#x20;     gl.uniform1f(uOff, off ? 1 : 0);

&#x20;     let k = 0;

&#x20;     if (revealAt) {

&#x20;       const x = Math.min(1, (now - revealAt) / REVEAL\_MS);

&#x20;       k = x < .5 ? 2 \* x \* x : 1 - Math.pow(-2 \* x + 2, 2) / 2;   // ease in-out

&#x20;       if (x >= 1 \&\& revealDone) { const done = revealDone; revealDone = null; setTimeout(done, 60); }

&#x20;     }

&#x20;     gl.uniform1f(uReveal, k);

&#x20;     gl.drawArrays(gl.TRIANGLE\_STRIP, 0, 4);

&#x20;     if (off || (revealAt \&\& !revealDone)) return;

&#x20;     if (!still) raf = requestAnimationFrame(frame);

&#x20;     else setTimeout(() => { if (!raf) raf = requestAnimationFrame(frame); }, 1000);

&#x20;   }

&#x20;   panel.insertBefore(canvas, panel.firstChild);

&#x20;   panel.classList.add("nm-gen-gl");

&#x20;   raf = requestAnimationFrame(frame);

&#x20;   return {

&#x20;     stop() { off = true; drawn = ""; if (!raf) raf = requestAnimationFrame(frame); },

&#x20;     reveal(source) {

&#x20;       return new Promise((resolve) => {

&#x20;         try {

&#x20;           gl.activeTexture(gl.TEXTURE1);

&#x20;           gl.bindTexture(gl.TEXTURE\_2D, frameTex);

&#x20;           gl.pixelStorei(gl.UNPACK\_PREMULTIPLY\_ALPHA\_WEBGL, false);

&#x20;           gl.texImage2D(gl.TEXTURE\_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED\_BYTE, source);

&#x20;           gl.activeTexture(gl.TEXTURE0);

&#x20;         } catch (error) { console.warn("\[image panel] reveal:", error); resolve(); return; }

&#x20;         revealDone = resolve;

&#x20;         revealAt = performance.now();

&#x20;         if (!raf) raf = requestAnimationFrame(frame);

&#x20;       });

&#x20;     },

&#x20;   };

&#x20; }



&#x20; // ---- the picture's tools and the viewer ------------------------------------------

&#x20; const ICONS = {

&#x20;   share: '<path d="M12 3v12M7.5 7.5 12 3l4.5 4.5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>',

&#x20;   copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',

&#x20;   download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M5 19h14"/>',

&#x20;   back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',

&#x20;   done: '<path d="M5 12.5 10 17l9-10"/>',

&#x20; };

&#x20; function iconButton(kind, title, onClick) {

&#x20;   const button = document.createElement("button");

&#x20;   button.type = "button";

&#x20;   button.className = "nm-tool";

&#x20;   button.title = title;

&#x20;   button.setAttribute("aria-label", title);

&#x20;   button.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" ' +

&#x20;     'stroke-linecap="round" stroke-linejoin="round">' + ICONS\[kind] + "</svg>";

&#x20;   button.addEventListener("click", (event) => { event.stopPropagation(); onClick(button); });

&#x20;   return button;

&#x20; }

&#x20; const flash = (button, kind) => {

&#x20;   const before = button.innerHTML;

&#x20;   button.innerHTML = button.innerHTML.replace(/<svg(\[^>]\*)>\[\\s\\S]\*<\\/svg>/, "<svg$1>" + ICONS\[kind] + "</svg>");

&#x20;   setTimeout(() => { button.innerHTML = before; }, 1200);

&#x20; };

&#x20; function savePicture(url, name) {

&#x20;   const a = document.createElement("a");

&#x20;   a.href = url;

&#x20;   a.download = name;

&#x20;   document.body.appendChild(a);

&#x20;   a.click();

&#x20;   a.remove();

&#x20; }

&#x20; async function copyPicture(img, button) {

&#x20;   try {

&#x20;     // The clipboard takes PNG; the picture is drawn into one.

&#x20;     const canvas = document.createElement("canvas");

&#x20;     canvas.width = img.naturalWidth;

&#x20;     canvas.height = img.naturalHeight;

&#x20;     canvas.getContext("2d").drawImage(img, 0, 0);

&#x20;     const png = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));

&#x20;     await navigator.clipboard.write(\[new ClipboardItem({ "image/png": png })]);

&#x20;     flash(button, "done");

&#x20;   } catch (error) {

&#x20;     button.title = "This browser would not copy the picture";

&#x20;   }

&#x20; }

&#x20; async function sharePicture(url, name) {

&#x20;   try {

&#x20;     const blob = await (await fetch(url)).blob();

&#x20;     const file = new File(\[blob], name, { type: blob.type || "image/png" });

&#x20;     if (navigator.canShare \&\& navigator.canShare({ files: \[file] })) await navigator.share({ files: \[file] });

&#x20;     else savePicture(url, name);

&#x20;   } catch (error) {

&#x20;     if (error \&\& error.name !== "AbortError") console.warn("\[image panel] share:", error);

&#x20;   }

&#x20; }

&#x20; /\*\* Share, copy and download, on the picture's top right. Each shows only where the browser can do it. \*/

&#x20; function pictureTools(url, name, img, extra) {

&#x20;   const tools = document.createElement("div");

&#x20;   tools.className = "nm-tools" + (extra ? " " + extra : "");

&#x20;   if (navigator.share) tools.append(iconButton("share", "Share", () => sharePicture(url, name)));

&#x20;   if (window.ClipboardItem \&\& navigator.clipboard \&\& navigator.clipboard.write) {

&#x20;     tools.append(iconButton("copy", "Copy", (b) => copyPicture(img, b)));

&#x20;   }

&#x20;   tools.append(iconButton("download", "Download", () => savePicture(url, name)));

&#x20;   return tools;

&#x20; }

&#x20; /\*\* The picture, large, over the page: back (or Esc, or a click beside it) closes it. \*/

&#x20; function openViewer(url, name, source) {

&#x20;   injectStyles();

&#x20;   const view = document.createElement("div");

&#x20;   view.className = "nm-viewer";

&#x20;   view.setAttribute("role", "dialog");

&#x20;   view.setAttribute("aria-label", "Picture");

&#x20;   const top = document.createElement("div");

&#x20;   top.className = "nm-viewer-top";

&#x20;   const big = document.createElement("img");

&#x20;   big.src = url;

&#x20;   big.alt = "";

&#x20;   const close = () => {

&#x20;     view.classList.add("nm-viewer-out");

&#x20;     document.removeEventListener("keydown", onKey, true);

&#x20;     setTimeout(() => view.remove(), 180);

&#x20;   };

&#x20;   const onKey = (event) => { if (event.key === "Escape") { event.stopPropagation(); close(); } };

&#x20;   top.append(iconButton("back", "Close", close), pictureTools(url, name, source, "nm-tools-top"));

&#x20;   view.append(top, big);

&#x20;   view.addEventListener("click", (event) => { if (event.target === view) close(); });

&#x20;   document.addEventListener("keydown", onKey, true);

&#x20;   document.body.appendChild(view);

&#x20;   top.querySelector(".nm-tool").focus();

&#x20; }



&#x20; // ---- the panel --------------------------------------------------------------------

&#x20; /\*\*

&#x20;  \* create(container, {stage}) -> panel

&#x20;  \*   panel.step(line)                  a progress event's `step`; moves the stage and the bar

&#x20;  \*   panel.done(src, {name}) -> Promise<HTMLImageElement>

&#x20;  \*                                     src: a blob: URL or a Blob of the picture. Takes its shape,

&#x20;  \*                                     ripples it in, then puts the picture (with its tools) in place.

&#x20;  \*   panel.fail(message, {cancelled})  stills and greys the sheet with the reason

&#x20;  \*   panel.destroy()

&#x20;  \*/

&#x20; function create(container, options) {

&#x20;   injectStyles();

&#x20;   options = options || {};

&#x20;   const host = document.createElement("div");

&#x20;   const sheet = document.createElement("div");

&#x20;   sheet.className = "nm-gen";

&#x20;   sheet.innerHTML = '<div class="nm-gen-smoke"></div>' +

&#x20;     '<div class="nm-gen-mid"><div class="nm-gen-icon">✦</div><div class="nm-gen-pct"></div>' +

&#x20;     '<div class="nm-gen-stage"></div><div class="nm-gen-time"></div></div><div class="nm-gen-bar"></div>';

&#x20;   const pick = (cls) => sheet.querySelector("." + cls);

&#x20;   pick("nm-gen-stage").textContent = options.stage || "Starting";

&#x20;   host.appendChild(sheet);

&#x20;   container.appendChild(host);

&#x20;   const water = startWater(sheet, () =>

&#x20;     \["nm-gen-icon", "nm-gen-pct", "nm-gen-stage", "nm-gen-time"].map((cls) => pick(cls).textContent), TINT);

&#x20;   const since = Date.now();

&#x20;   let ended = false, at = 0;

&#x20;   const clock = setInterval(() => {

&#x20;     if (ended || !sheet.isConnected) { clearInterval(clock); return; }

&#x20;     pick("nm-gen-time").textContent = seconds(Date.now() - since);

&#x20;   }, 1000);



&#x20;   return {

&#x20;     element: host,

&#x20;     step(line) {

&#x20;       if (ended) return;

&#x20;       const friendly = friendlyStep(String(line || ""));

&#x20;       if (!friendly) return;

&#x20;       at = Math.max(at, friendly\[1]);                       // the bar never goes back

&#x20;       pick("nm-gen-stage").textContent = friendly\[0];

&#x20;       pick("nm-gen-bar").style.width = Math.round(at \* 100) + "%";

&#x20;     },

&#x20;     done(src, opts) {

&#x20;       ended = true;

&#x20;       clearInterval(clock);

&#x20;       opts = opts || {};

&#x20;       const url = src instanceof Blob ? URL.createObjectURL(src) : src;

&#x20;       const name = opts.name || "picture.png";

&#x20;       pick("nm-gen-time").textContent = "";

&#x20;       pick("nm-gen-bar").style.width = "100%";

&#x20;       const shot = document.createElement("div");

&#x20;       shot.className = "nm-shot";

&#x20;       shot.style.display = "none";

&#x20;       const img = document.createElement("img");

&#x20;       img.alt = opts.alt || "";

&#x20;       img.src = url;

&#x20;       shot.append(img, pictureTools(url, name, img));

&#x20;       img.addEventListener("click", () => openViewer(url, name, img));

&#x20;       host.appendChild(shot);

&#x20;       const swap = () => { sheet.remove(); shot.style.display = ""; return img; };

&#x20;       return img.decode().then(() => {

&#x20;         // The sheet takes the picture's shape first, so the swap does not jump.

&#x20;         if (img.naturalWidth \&\& img.naturalHeight) sheet.style.aspectRatio = img.naturalWidth + "/" + img.naturalHeight;

&#x20;         return water ? water.reveal(img).then(swap) : swap();

&#x20;       }, () => { this.fail("Could not show the picture."); return null; });

&#x20;     },

&#x20;     fail(message, opts) {

&#x20;       ended = true;

&#x20;       clearInterval(clock);

&#x20;       if (water) water.stop();

&#x20;       sheet.classList.add("nm-gen-off");

&#x20;       pick("nm-gen-icon").textContent = opts \&\& opts.cancelled ? "✕" : "⚠️";

&#x20;       pick("nm-gen-pct").textContent = "";

&#x20;       pick("nm-gen-time").textContent = "";

&#x20;       pick("nm-gen-stage").textContent = message || "The picture failed.";

&#x20;     },

&#x20;     destroy() { ended = true; clearInterval(clock); host.remove(); },

&#x20;   };

&#x20; }



&#x20; global.NinferImagePanel = { create, friendlyStep, openViewer, pictureTools, seconds, TINT };

})(typeof window !== "undefined" ? window : globalThis);

```



\---



\## 3. Putting it together: make a picture, show it, log it



```js

// base: "https://ninfer.neronexusai.com"   token: the user's API key

// picture (optional): a data URL of a picture to edit; then the prompt says what to change.

async function makePicture({ base, token, prompt, picture }, container, log) {

&#x20; const auth = { authorization: "Bearer " + token };

&#x20; const { seconds: secs } = NinferImagePanel;

&#x20; const model = "Nano Banana";

&#x20; const started = Date.now();



&#x20; log((picture ? "Editing your picture with " : "Making a picture with ") + model + ".");

&#x20; const panel = NinferImagePanel.create(container);

&#x20; const response = await fetch(base + (picture ? "/v1/images/edits" : "/v1/images/generations"), {

&#x20;   method: "POST", headers: { ...auth, "content-type": "application/json" },

&#x20;   body: JSON.stringify(picture

&#x20;     ? { model, prompt, images: \[picture], stream: true }

&#x20;     : { model, prompt, stream: true, response\_format: "url" }),

&#x20; });

&#x20; if (!response.ok || !response.body) {

&#x20;   const body = await response.json().catch(() => ({}));

&#x20;   const message = (body.error \&\& body.error.message) || "HTTP " + response.status;

&#x20;   panel.fail(message);

&#x20;   log("⚠️ " + message);

&#x20;   return;

&#x20; }



&#x20; // Server-Sent Events: blocks split by a blank line, each with "data: {json}".

&#x20; const reader = response.body.getReader();

&#x20; const decoder = new TextDecoder();

&#x20; let buffer = "", result = null, failure = null;

&#x20; for (;;) {

&#x20;   const { value, done } = await reader.read();

&#x20;   if (done) break;

&#x20;   buffer += decoder.decode(value, { stream: true });

&#x20;   let cut;

&#x20;   while ((cut = buffer.indexOf("\\n\\n")) >= 0) {

&#x20;     const block = buffer.slice(0, cut);

&#x20;     buffer = buffer.slice(cut + 2);

&#x20;     const data = block.split("\\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");

&#x20;     if (!data) continue;                                   // a ": keep-alive" comment

&#x20;     let event;

&#x20;     try { event = JSON.parse(data); } catch (\_) { continue; }

&#x20;     if (event.type === "image\_generation.progress") {

&#x20;       const step = String(event.step || "").trim();

&#x20;       if (!step) continue;

&#x20;       panel.step(step);

&#x20;       log(step + " · " + secs(Date.now() - started));

&#x20;     } else if (event.type === "image\_generation.completed") {

&#x20;       result = event;

&#x20;     } else if (event.type === "error") {

&#x20;       failure = (event.error \&\& event.error.message) || "The picture failed.";

&#x20;     }

&#x20;   }

&#x20; }

&#x20; if (failure || !result) {

&#x20;   panel.fail(failure || "The server ended without a picture.");

&#x20;   log("⚠️ " + (failure || "The server ended without a picture."));

&#x20;   return;

&#x20; }

&#x20; // The picture comes in the event itself, so no second download is needed.

&#x20; const bytes = Uint8Array.from(atob(result.b64\_json), (c) => c.charCodeAt(0));

&#x20; const blob = new Blob(\[bytes], { type: result.media\_type || "image/png" });

&#x20; const name = decodeURIComponent((result.url || "picture.png").split("/").pop().split("?")\[0]);

&#x20; await panel.done(blob, { name, alt: prompt });

&#x20; const made = result.seconds != null ? `made in ${Math.round(result.seconds)} s, ` : "";

&#x20; log(`✅ Done (${made}${secs(Date.now() - started)} in all).`);

&#x20; return result.url;                                         // keep it to show the picture again later

}

```



To show a picture again later (an old chat), keep `result.url`. Create the panel, fetch

the URL with the `Authorization` header as a blob, then call `panel.done(blob, {name})`.

It ripples in the same way. A `404` means the monitor no longer keeps that picture.



\---



\## 4. The progress log, as text



What the chat page puts in its "Reasoning" block: each `step` as the server sends it,

with the time since the request. A terminal harness can print the same lines. A real

run (`create a alien`, 24 s, the picture's local paths shortened):



```

Making a picture with Nano Banana.

Starting Chrome · 0 s

playwright: Connecting to existing Chrome via CDP: http://localhost:9222 · 0 s

playwright: Connected to Chrome via CDP · 1 s

Opening Gemini · 1 s

playwright: New chat · 2 s

Waiting for Gemini to load · 2 s

Locating prompt input · 4 s

Typing prompt · 4 s

playwright: Prompt: "create a alien" · 8 s

Submitting prompt · 8 s

Waiting for image generation (up to 180s) · 9 s

playwright: Image card showing · 11 s

Creating the image... (10s elapsed) · 19 s

playwright: Detected 1 new image(s) (stable after 2 checks) · 23 s

Image detected! Downloading · 23 s

downloader: Saved 1357062 bytes to …\\20261109\_045943\_create\_a\_alien.png · 23 s

Download complete: …\\20261109\_045943\_create\_a\_alien.png · 23 s

synthid balanced: badge erased · provenance clean · 723 ms · 24 s

saved 2026-11-09/045944

✅ Done (made in 24 s, 25 s in all).

```



The rules:

\- \*\*There is no polling:\*\* the lines arrive as the bot writes them. A quiet stretch

&#x20; (Gemini drawing) is normal; it is usually 10 to 15 s.

\- \*\*Format:\*\* `<step> · <seconds since the request>`.

\- \*\*A terminal that wants fewer lines\*\* can print only the lines `friendlyStep`

&#x20; recognises, as `NN% · <words>` (from its fraction), and skip the `playwright:` and

&#x20; `downloader:` detail.

\- \*\*End with one of:\*\*

&#x20; - `✅ Done (made in X s, Y s in all).` (X is the event's `seconds`)

&#x20; - `⚠️ <error.message>`

\- \*\*Gemini stalls:\*\* when no picture card appears within 20 s, or Gemini answers in

&#x20; words, the bot asks again by itself (up to twice). The line says

&#x20; `sending the prompt again`, and the panel shows "Gemini stalled · asking again".

\- \*\*Plain-word stages\*\* (`friendlyStep`):



&#x20; | Bot line contains | Shown as | Bar |

&#x20; |---|---|---|

&#x20; | waiting for its turn / queue | Waiting for its turn | 5% |

&#x20; | Starting Chrome / Connecting | Opening the browser | 10% |

&#x20; | Opening Gemini / Waiting for Gemini to load / Locating / New chat | Opening Gemini | 20% |

&#x20; | Uploading (edits) | Sending your picture | 25% |

&#x20; | Typing / Submitting | Sending the prompt | 30% |

&#x20; | sending the prompt again | Gemini stalled · asking again | 35% |

&#x20; | Waiting for image generation / the edited image | Waiting for Gemini | 40% |

&#x20; | Creating the image | Creating the image | 65% |

&#x20; | Image detected / Downloading / Download complete | Saving the picture | 90% |

&#x20; | SynthID / clean | Finishing the picture | 95% |



\---



\## 5. Behaviour notes



\- \*\*Colour:\*\* `TINT` is `\[r, g, b, amount]` applied to the water's brightness before

&#x20; the words are drawn, so the words stay white. `\[0,0,0,0]` gives the video's lilac

&#x20; sheet. The CSS fallback (`.nm-gen` background, smoke and bar) has the same amber.

\- \*\*Size:\*\* the sheet is square, up to 520 px wide, while the picture is made. When it

&#x20; arrives, the sheet takes the picture's own shape before the reveal, so the `<img>`

&#x20; replaces it without a jump. Both have 16 px corners; change `.nm-gen` and `.nm-shot`

&#x20; together.

\- \*\*Tools:\*\* Share shows only where the browser can share files (phones, Safari, Edge).

&#x20; Copy shows only where the clipboard takes pictures, and always copies a PNG. Download

&#x20; is always there. On a touch screen the buttons stay visible; with a mouse they appear

&#x20; on hover or keyboard focus.

\- \*\*Viewer:\*\* a fixed overlay over the whole page, blurred behind. Back is on the

&#x20; top left and the tools on the top right. Esc, back or a click beside the picture

&#x20; closes it. It sits above everything (`z-index` 2147483000).

\- \*\*Performance:\*\* one full-screen pass per frame at up to 2× device pixels. It stops

&#x20; by itself when the sheet leaves the page or the picture is shown.

\- \*\*No WebGL:\*\* a still CSS sheet with a dark centre and the same words is shown, and

&#x20; the picture replaces it directly.

\- \*\*Reduced motion:\*\* with the system's "Reduce Motion" setting on, the water stands

&#x20; still.

\- \*\*A reload while a picture is made:\*\* the request goes with the page and there is no

&#x20; job id to follow. The picture is still made and kept: it is in the monitor's Images

&#x20; page, and a client that kept nothing can show the user that instead.

\- \*\*Tunable values:\*\* the same as the video panel's (ripple pace and strength, mesh

&#x20; size and brightness, edge light, `REVEAL\_MS`), plus `TINT`.




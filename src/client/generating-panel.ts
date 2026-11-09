/**
 * The "picture being made" panel: a WebGL water sheet tinted amber, with the stage,
 * the time so far and a progress bar drawn on the water, and a slow ripple that
 * brings the finished picture up. Ported from the NInfer image panel
 * (image-generating-panel.md); no dependencies.
 */

export const REVEAL_MS = 2800
/** Amber: rgb, then how much (0 = the video panel's lilac). */
export const IMAGE_TINT: readonly [number, number, number, number] = [1.0, 0.66, 0.36, 0.85]
export const formatSeconds = (ms: number): string => `${Math.max(0, Math.round(ms / 1000))} s`

/** A bot progress line as someone watching would say it, and how far along it is (0..1). */
export function friendlyStep(line: string): [string, number] | null {
  const rules: Array<[RegExp, string, number]> = [
    [/waiting for (its|the|an) (turn|earlier|other)|queue/i, 'Waiting for its turn', 0.05],
    [/Starting (Chrome|headless)|Spawning Chrome|Connecting/i, 'Opening the browser', 0.1],
    [/Opening Gemini|Waiting for Gemini to load|Locating|New chat/i, 'Opening Gemini', 0.2],
    [/Uploading/i, 'Sending your picture', 0.25],
    [/Typing|Submitting/i, 'Sending the prompt', 0.3],
    [/sending the prompt again/i, 'Gemini stalled · asking again', 0.35],
    [/Waiting for (image generation|the edited image)|Still generating/i, 'Waiting for Gemini', 0.4],
    [/Creating the image/i, 'Creating the image', 0.65],
    [/Image detected|Downloading|Download complete/i, 'Saving the picture', 0.9],
    [/SynthID|clean/i, 'Finishing the picture', 0.95],
  ]
  for (const [pattern, words, at] of rules) if (pattern.test(line)) return [words, at]
  return null
}

// ---- styles ------------------------------------------------------------------------
const CSS = `
.nm-gen{position:relative;width:100%;max-width:520px;aspect-ratio:1/1;border-radius:12px;overflow:hidden;isolation:isolate;line-height:normal;
  background:radial-gradient(120% 95% at 50% 0%,#b39a86 0%,#86695a 52%,#5f4a40 100%);box-shadow:0 1px 0 rgba(255,255,255,.06),0 8px 30px rgba(0,0,0,.35);
  animation:nm-gen-in .35s cubic-bezier(.2,.8,.2,1) both;transition:aspect-ratio .3s ease}
@keyframes nm-gen-in{from{opacity:0;transform:translateY(6px) scale(.985)}}
.nm-gen canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.nm-gen-smoke{position:absolute;inset:0;background:radial-gradient(ellipse 58% 55% at 50% 50%,rgba(28,18,12,.85),rgba(28,18,12,.35) 60%,transparent 100%);
  box-shadow:inset 0 0 40px rgba(255,220,180,.4)}
.nm-gen-mid{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:16px;text-align:center;
  color:rgba(246,244,255,.95);text-shadow:0 1px 14px rgba(0,0,0,.55);font:500 13px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif}
.nm-gen-icon{font-size:18px;opacity:.85}
.nm-gen-pct{font:300 30px/1.1 system-ui,-apple-system,"Segoe UI",sans-serif;font-variant-numeric:tabular-nums}
.nm-gen-pct:empty{display:none}
.nm-gen-stage{opacity:.85}.nm-gen-time{opacity:.55;font-size:12px;font-variant-numeric:tabular-nums}
.nm-gen.nm-gen-gl .nm-gen-smoke,.nm-gen.nm-gen-gl .nm-gen-mid{visibility:hidden}
.nm-gen-bar{position:absolute;left:0;bottom:0;height:2px;width:0;transition:width .8s ease;
  background:linear-gradient(90deg,rgba(240,190,140,.7),rgba(255,248,236,.98));box-shadow:0 0 10px rgba(255,214,170,.8)}
.nm-gen.nm-gen-off:not(.nm-gen-gl){filter:grayscale(1) brightness(.72)}
.nm-gen.nm-gen-off .nm-gen-bar{display:none}
@media (prefers-reduced-motion:reduce){.nm-gen{animation:none}}`

function injectStyles(): void {
  if (document.getElementById('nm-img-css')) return
  const style = document.createElement('style')
  style.id = 'nm-img-css'
  style.textContent = CSS
  document.head.appendChild(style)
}

// ---- the water (WebGL) -------------------------------------------------------------
const VS = 'attribute vec2 p;varying vec2 v;void main(){v=vec2(p.x*.5+.5,.5-p.y*.5);gl_Position=vec4(p,0.,1.);}'
const FS = `precision highp float;
varying vec2 v;uniform float t;uniform vec2 res;uniform sampler2D words;uniform float off;uniform sampler2D frame;uniform float reveal;uniform vec4 tint;
float h(vec2 q){return fract(sin(dot(q,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 q){vec2 i=floor(q),f=fract(q);f=f*f*(3.-2.*f);
  return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 q){float s=0.,a=.5;for(int i=0;i<4;i++){s+=a*n(q);q=q*2.03+vec2(1.7,9.2);a*=.5;}return s;}
void main(){
  float asp=res.x/res.y;vec2 c=(v-.5)*vec2(asp,1.);
  vec2 o=vec2(0.);float crest=0.,wv=0.;
  for(int i=0;i<4;i++){
    float fi=float(i);float P=7.+fi*2.3+h(vec2(fi,3.1))*3.;
    float tt=t+h(vec2(fi,9.7))*P;float k=floor(tt/P);float lt=tt-k*P;
    float delay=h(vec2(k,fi+.5))*P*.45;lt-=delay;
    if(lt>0.){
      vec2 src=(vec2(h(vec2(k,fi+1.3)),h(vec2(fi+2.1,k)))-.5)*vec2(asp*.75,.7);
      if(i==0)src*=.35;
      float speed=.11+.07*h(vec2(k+4.,fi));float amp=.55+.45*h(vec2(fi,k+7.));
      vec2 dv=c-src;float r=length(dv);float R=lt*speed;float d=r-R;
      float fade=amp*exp(-R*1.6)*smoothstep(0.,.35,lt);
      float env=exp(-d*d*22.);
      float wave=sin(d*30.)*env*fade;wv+=wave;
      o+=(dv/max(r,1e-4))*wave*.024;
      crest+=exp(-d*d*700.)*fade;
    }
  }
  o+=vec2(sin(c.y*3.1+t*.42)+.7*sin(c.x*2.3-t*.31+1.),cos(c.x*2.7+t*.37)+.7*sin(c.y*3.7-t*.27))*.0042;
  vec2 u=v+o/vec2(asp,1.);vec2 cu=(u-.5)*vec2(asp,1.);
  vec3 col=mix(vec3(.55,.565,.665),vec3(.26,.275,.35),smoothstep(-.1,1.1,u.y));
  vec2 warp=vec2(fbm(cu*1.1+vec2(t*.07,0.)),fbm(cu*1.1+vec2(3.2,-t*.06)));
  float s=fbm(cu*1.25+warp*1.35+vec2(t*.05,-t*.035));
  float dark=smoothstep(.4,.95,s+.5-length(cu*vec2(.8,1.))*.85);
  col=mix(col,vec3(.07,.075,.105),dark*.9);
  vec2 g=cu*46.;vec2 f=fract(g)-.5;float px=46./res.y*.9;
  float p1=abs(f.x+f.y)*.7071,p2=abs(f.x-f.y)*.7071;
  float w1=mix(.13,.03,smoothstep(0.,.62,p1)),w2=mix(.13,.03,smoothstep(0.,.62,p2));
  float star=max(1.-smoothstep(w1-px*.5,w1+px*.5,p2),1.-smoothstep(w2-px*.5,w2+px*.5,p1));
  float ex0=min(v.x,1.-v.x)*asp,ey0=min(v.y,1.-v.y);float e0=min(ex0,ey0);
  float meshMask=.12+.38*exp(-e0*6.)+abs(wv)*.7;
  float lift=clamp(1.+3.*wv,0.,3.4);
  col+=vec3(.88,.88,1.)*star*min(meshMask,1.1)*(.07+.03*dark)*lift;
  col+=vec3(.86,.83,1.)*crest*.2;
  float ex=min(v.x,1.-v.x)*asp,ey=min(v.y,1.-v.y);float e=-log(exp(-ex*14.)+exp(-ey*14.))/14.;
  col+=vec3(.92,.9,1.)*exp(-max(e,0.)*11.)*(.24+.08*sin(t*1.3));
  col+=vec3(1.)*exp(-(1.-v.x)*asp*9.)*(.1+.1*sin(t*.7));
  col+=vec3(.93,.9,1.)*exp(-v.x*asp*10.)*(.06+.06*sin(t*.55+1.));
  if(tint.a>0.){float lum=dot(col,vec3(.299,.587,.114));col=mix(col,lum*tint.rgb*1.55,tint.a);}
  vec4 w=texture2D(words,v+o/vec2(asp,1.)*1.1);
  col=col*(1.-w.a)+w.rgb;
  if(off>.5)col=vec3(dot(col,vec3(.299,.587,.114)))*.8;
  if(reveal>0.){float rv=length(c);vec2 dir=c/max(rv,1e-4);float Rv=reveal*1.5;float dv2=rv-Rv;
    float inside=1.-smoothstep(-.22,.03,dv2);
    vec2 fo=dir*sin(dv2*30.)*exp(-dv2*dv2*22.)*.024*(1.-reveal)+o*(1.-reveal);
    vec3 fr=texture2D(frame,v+fo/vec2(asp,1.)).rgb;
    col=mix(col,fr,inside);
    col+=vec3(.9,.88,1.)*exp(-dv2*dv2*500.)*.28*(1.-reveal);}
  gl_FragColor=vec4(col,1.);}`

interface Water {
  stop(): void
  reveal(source: TexImageSource): Promise<void>
  dispose(): void
}

/** Draws the water and the words into `panel`; null where WebGL is not to be had. */
function startWater(panel: HTMLElement, wordsOf: () => string[], tint: readonly number[]): Water | null {
  const canvas = document.createElement('canvas')
  let gl: WebGLRenderingContext | null = null
  try { gl = canvas.getContext('webgl', { antialias: false, premultipliedAlpha: false, alpha: false }) } catch { /* no WebGL */ }
  if (!gl) return null
  const g = gl
  const shader = (type: number, src: string): WebGLShader => {
    const sh = g.createShader(type)
    if (!sh) throw new Error('createShader failed')
    g.shaderSource(sh, src)
    g.compileShader(sh)
    if (!g.getShaderParameter(sh, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(sh) ?? 'compile failed')
    return sh
  }
  let prog: WebGLProgram
  try {
    const p = g.createProgram()
    if (!p) throw new Error('createProgram failed')
    g.attachShader(p, shader(g.VERTEX_SHADER, VS))
    g.attachShader(p, shader(g.FRAGMENT_SHADER, FS))
    g.linkProgram(p)
    if (!g.getProgramParameter(p, g.LINK_STATUS)) throw new Error(g.getProgramInfoLog(p) ?? 'link failed')
    prog = p
  } catch (error) {
    console.warn('[dsh-image-gen] water:', error instanceof Error ? error.message : error)
    return null
  }
  g.useProgram(prog)
  g.bindBuffer(g.ARRAY_BUFFER, g.createBuffer())
  g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW)
  const loc = g.getAttribLocation(prog, 'p')
  g.enableVertexAttribArray(loc)
  g.vertexAttribPointer(loc, 2, g.FLOAT, false, 0, 0)
  const U = (name: string) => g.getUniformLocation(prog, name)
  const uT = U('t'), uRes = U('res'), uOff = U('off'), uReveal = U('reveal')
  g.uniform4fv(U('tint'), new Float32Array(tint))
  let revealAt = 0
  let revealDone: (() => void) | null = null

  const setupTexture = () => {
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR)
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR)
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE)
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE)
  }
  // The picture on texture unit 1; the words on unit 0.
  const frameTex = g.createTexture()
  g.activeTexture(g.TEXTURE1)
  g.bindTexture(g.TEXTURE_2D, frameTex)
  setupTexture()
  g.uniform1i(U('frame'), 1)
  g.activeTexture(g.TEXTURE0)
  const tex = g.createTexture()
  g.bindTexture(g.TEXTURE_2D, tex)
  setupTexture()
  g.uniform1i(U('words'), 0)

  const words = document.createElement('canvas')
  const ctx = words.getContext('2d')
  let drawn = '', off = false, raf = 0, disposed = false
  const start = performance.now()
  const still = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  function size(): number {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = Math.max(1, Math.round(panel.clientWidth * dpr))
    const h = Math.max(1, Math.round(panel.clientHeight * dpr))
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = words.width = w
      canvas.height = words.height = h
      drawn = ''
      g.viewport(0, 0, w, h)
    }
    return dpr
  }
  // The words go to the shader as a texture, so the ripples bend them too.
  function paintWords(dpr: number): void {
    if (!ctx) return
    const lines = wordsOf()
    const key = `${lines.join('\n')}|${canvas.width}x${canvas.height}`
    if (key === drawn) return
    drawn = key
    const W = words.width, H = words.height
    ctx.clearRect(0, 0, W, H)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = 'rgba(0,0,0,.55)'
    ctx.shadowBlur = 12 * dpr
    ctx.shadowOffsetY = dpr
    const font = 'system-ui,-apple-system,"Segoe UI",sans-serif'
    const [icon, pct, stage, time] = lines
    const rows: Array<[string, string, string, number]> = []
    if (icon) rows.push([icon, `400 ${17 * dpr}px ${font}`, 'rgba(246,244,255,.85)', 26 * dpr])
    if (pct) rows.push([pct, `300 ${30 * dpr}px ${font}`, 'rgba(250,248,255,.97)', 38 * dpr])
    if (stage) rows.push([stage, `500 ${13 * dpr}px ${font}`, 'rgba(246,244,255,.88)', 20 * dpr])
    if (time) rows.push([time, `400 ${12 * dpr}px ${font}`, 'rgba(246,244,255,.55)', 18 * dpr])
    let y = H / 2 - rows.reduce((sum, row) => sum + row[3], 0) / 2
    for (const [text, f, color, lh] of rows) {
      ctx.font = f
      ctx.fillStyle = color
      ctx.fillText(text, W / 2, y + lh / 2, W - 32 * dpr)
      y += lh
    }
    g.bindTexture(g.TEXTURE_2D, tex)
    g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, words)
  }
  function frame(now: number): void {
    raf = 0
    if (disposed || !panel.isConnected) return // removed from the page: stops by itself
    const dpr = size()
    paintWords(dpr)
    g.uniform1f(uT, still ? 0 : (now - start) / 1000)
    g.uniform2f(uRes, canvas.width, canvas.height)
    g.uniform1f(uOff, off ? 1 : 0)
    let k = 0
    if (revealAt) {
      const x = Math.min(1, (now - revealAt) / REVEAL_MS)
      k = x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2 // ease in-out
      if (x >= 1 && revealDone) { const done = revealDone; revealDone = null; setTimeout(done, 60) }
    }
    g.uniform1f(uReveal, k)
    g.drawArrays(g.TRIANGLE_STRIP, 0, 4)
    if (off || (revealAt && !revealDone)) return
    if (!still) raf = requestAnimationFrame(frame)
    else setTimeout(() => { if (!raf) raf = requestAnimationFrame(frame) }, 1000)
  }
  panel.insertBefore(canvas, panel.firstChild)
  panel.classList.add('nm-gen-gl')
  raf = requestAnimationFrame(frame)

  return {
    stop() { off = true; drawn = ''; if (!raf) raf = requestAnimationFrame(frame) },
    reveal(source) {
      return new Promise<void>((resolve) => {
        try {
          g.activeTexture(g.TEXTURE1)
          g.bindTexture(g.TEXTURE_2D, frameTex)
          g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
          g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, source)
          g.activeTexture(g.TEXTURE0)
        } catch (error) {
          console.warn('[dsh-image-gen] reveal:', error)
          resolve()
          return
        }
        revealDone = resolve
        revealAt = performance.now()
        if (!raf) raf = requestAnimationFrame(frame)
      })
    },
    dispose() {
      disposed = true
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      // Hand the GL context back at once: browsers cap how many can be alive.
      g.getExtension('WEBGL_lose_context')?.loseContext()
    },
  }
}

// ---- the panel ---------------------------------------------------------------------
export interface GeneratingPanelOptions {
  /** The words under the clock while the picture is made. */
  stage?: string
  /** Typical time to a picture, for the estimated bar when no progress lines come (ms). */
  expectedMs?: number
}

export interface GeneratingPanel {
  readonly element: HTMLElement
  /** A bot progress line; moves the stage and the bar when recognised. */
  step(line: string): void
  /** Sets the stage words directly. */
  setStage(words: string): void
  /** Takes the picture's displayed size, then ripples it in. Resolves when the picture covers the sheet. */
  reveal(image: HTMLImageElement, size?: { width: number; height: number }): Promise<void>
  /** Stills and greys the sheet with the reason. */
  fail(message: string, opts?: { cancelled?: boolean }): void
  destroy(): void
}

export function createGeneratingPanel(container: HTMLElement, options: GeneratingPanelOptions = {}): GeneratingPanel {
  injectStyles()
  const sheet = document.createElement('div')
  sheet.className = 'nm-gen'
  sheet.setAttribute('role', 'status')
  sheet.innerHTML = '<div class="nm-gen-smoke"></div>'
    + '<div class="nm-gen-mid"><div class="nm-gen-icon">✦</div><div class="nm-gen-pct"></div>'
    + '<div class="nm-gen-stage"></div><div class="nm-gen-time"></div></div><div class="nm-gen-bar"></div>'
  const pick = (cls: string) => sheet.querySelector<HTMLElement>(`.${cls}`)!
  pick('nm-gen-stage').textContent = options.stage ?? 'Starting'
  pick('nm-gen-time').textContent = formatSeconds(0)
  container.appendChild(sheet)
  const water = startWater(sheet, () =>
    ['nm-gen-icon', 'nm-gen-pct', 'nm-gen-stage', 'nm-gen-time'].map(cls => pick(cls).textContent ?? ''), IMAGE_TINT)
  const since = Date.now()
  const expected = Math.max(1000, options.expectedMs ?? 25_000)
  let ended = false, at = 0, stepped = false
  const setBar = (value: number) => {
    at = Math.max(at, Math.min(1, value)) // the bar never goes back
    pick('nm-gen-bar').style.width = `${Math.round(at * 100)}%`
  }
  const tick = () => {
    if (ended || !sheet.isConnected) { clearInterval(clock); return }
    const elapsed = Date.now() - since
    pick('nm-gen-time').textContent = formatSeconds(elapsed)
    // No progress lines: an estimate that eases towards 90% and never claims done.
    if (!stepped) setBar(0.9 * (1 - Math.exp(-elapsed / expected)))
  }
  const clock = setInterval(tick, 1000)
  requestAnimationFrame(tick)

  return {
    element: sheet,
    step(line) {
      if (ended) return
      const friendly = friendlyStep(String(line || ''))
      if (!friendly) return
      stepped = true
      pick('nm-gen-stage').textContent = friendly[0]
      setBar(friendly[1])
    },
    setStage(words) {
      if (!ended) pick('nm-gen-stage').textContent = words
    },
    reveal(image, size) {
      ended = true
      clearInterval(clock)
      pick('nm-gen-time').textContent = ''
      pick('nm-gen-bar').style.width = '100%'
      // The sheet takes the picture's shape first, so the swap does not jump.
      if (size !== undefined && size.width > 0 && size.height > 0) {
        sheet.style.width = `${size.width}px`
        sheet.style.aspectRatio = `${size.width}/${size.height}`
      } else if (image.naturalWidth && image.naturalHeight) {
        sheet.style.aspectRatio = `${image.naturalWidth}/${image.naturalHeight}`
      }
      return water ? water.reveal(image) : Promise.resolve()
    },
    fail(message, opts) {
      ended = true
      clearInterval(clock)
      water?.stop()
      sheet.classList.add('nm-gen-off')
      pick('nm-gen-icon').textContent = opts?.cancelled ? '✕' : '⚠️'
      pick('nm-gen-pct').textContent = ''
      pick('nm-gen-time').textContent = ''
      pick('nm-gen-stage').textContent = message || 'The picture failed.'
    },
    destroy() {
      ended = true
      clearInterval(clock)
      water?.dispose()
      sheet.remove()
    },
  }
}

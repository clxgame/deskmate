export const RIG2D_FADE_MS = 120;
export function fadeProgress(start: number | null, now: number): number { return start === null ? 1 : Math.max(0, Math.min(1, (now-start)/RIG2D_FADE_MS)); }
export function drawSleepMarks(ctx: CanvasRenderingContext2D, size: number, clock: number): void {
  const smooth = (a: number, b: number, x: number) => { const t = Math.max(0,Math.min(1,(x-a)/(b-a))); return t*t*(3-2*t); };
  ctx.save(); ctx.scale(size/512,size/512); ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.lineJoin='round';
  for (let i=0; i<3; i++) {
    const phase=(clock/3.6+i/3)%1;
    ctx.save(); ctx.globalAlpha=.9*smooth(0,.14,phase)*(1-smooth(.72,1,phase));
    ctx.translate(337+62*phase+Math.sin(phase*Math.PI*2)*3,239-98*phase); ctx.rotate(-.14+.12*Math.sin(phase*Math.PI));
    ctx.font=`700 ${18+14*phase}px "Arial Rounded MT Bold", "Trebuchet MS", sans-serif`;
    ctx.lineWidth=3; ctx.strokeStyle='#f1f5ef'; ctx.fillStyle='#6b9bbc'; ctx.strokeText('z',0,0); ctx.fillText('z',0,0); ctx.restore();
  }
  ctx.restore();
}

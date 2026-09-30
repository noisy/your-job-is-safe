// The HUD layer drawn over the post-processed frame. This video has no permanent HUD: everything is
// staged inside the scenes. The layer only shows the title-safe guide when `?guides=1` is set (authoring aid).
import { Layer2D, W, H } from './gl';

const GUIDES = typeof location !== 'undefined' && new URLSearchParams(location.search).has('guides');

export class Hud {
  private layer = new Layer2D();
  private drawn = false;

  draw(_t: number, o: { opacity: number }) {
    if (!this.drawn) {
      const c = this.layer.ctx;
      this.layer.clear();
      if (GUIDES) {
        c.strokeStyle = 'rgba(255,0,255,0.6)';
        c.lineWidth = 1;
        c.strokeRect(W * 0.05, H * 0.05, W * 0.9, H * 0.9); // title safe (90%)
        c.strokeRect(W * 0.035, H * 0.035, W * 0.93, H * 0.93); // action safe (93%)
      }
      this.layer.upload();
      this.drawn = true;
    }
    void o;
    return this.layer.texture;
  }
}

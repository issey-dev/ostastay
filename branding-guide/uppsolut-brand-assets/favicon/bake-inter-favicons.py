#!/usr/bin/env python3
"""
Bake pixel-exact Uppsolut favicons from the REAL Inter Black 'U' glyph.

Run this once on a machine/CI that has the Inter Black font file:
    pip install fonttools pillow
    python bake-inter-favicons.py /path/to/Inter-Black.otf   (or a variable Inter .ttf)

Output: font-independent favicon.svg (outlined) + all PNG/ICO sizes,
identical to the wordmark's U.
"""
import sys, os
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen
from PIL import Image, ImageDraw

CRIMSON=(139,0,0); PLATINUM=(244,246,248)
OUT=os.path.dirname(os.path.abspath(__file__))

def load_U(path):
    f=TTFont(path)
    # if variable font, set weight to Black (900)
    try:
        from fontTools.varLib.instancer import instantiateVariableFont
        if "fvar" in f: instantiateVariableFont(f,{"wght":900},inplace=True)
    except Exception: pass
    upm=f["head"].unitsPerEm
    gs=f.getGlyphSet()
    cmap=f.getBestCmap()
    gname=cmap[ord("U")]
    # bounds
    bp=BoundsPen(gs); gs[gname].draw(bp); x0,y0,x1,y1=bp.bounds
    # svg path
    sp=SVGPathPen(gs); gs[gname].draw(sp); d=sp.getCommands()
    return d,(x0,y0,x1,y1),upm

def fit_transform(bounds, box=512, target=300):
    x0,y0,x1,y1=bounds
    gw,gh=x1-x0,y1-y0
    s=target/gh
    tx=(box-gw*s)/2 - x0*s
    ty=(box+gh*s)/2 + y0*s   # flip Y (font y-up -> svg y-down)
    return s,tx,ty

def main():
    if len(sys.argv)<2:
        print("usage: python bake-inter-favicons.py /path/to/Inter-Black.(otf|ttf)"); sys.exit(1)
    d,bounds,upm=load_U(sys.argv[1])
    s,tx,ty=fit_transform(bounds)
    # font y-up: apply matrix (s,0,0,-s,tx,ty)
    xform=f'translate({tx:.3f} {ty:.3f}) scale({s:.5f} {-s:.5f})'
    # favicon.svg (outlined, font-independent) — rounded crimson tile
    open(f"{OUT}/favicon.svg","w").write(
      f'<svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">\n'
      f'  <rect width="512" height="512" rx="115" fill="#8B0000"/>\n'
      f'  <path transform="{xform}" d="{d}" fill="#F4F6F8"/>\n</svg>\n')
    # also emit recolorable glyph + tiles
    for name,(bg,fg,rx) in {
        "uppsolut-icon-crimson":("#8B0000","#F4F6F8",115),
        "uppsolut-icon-platinum":("#F4F6F8","#8B0000",115),
        "uppsolut-icon-obsidian":("#0D0F11","#F4F6F8",115),
        "uppsolut-icon-maroon":("#580816","#F4F6F8",115),
    }.items():
        open(f"{OUT}/../icon/{name}.svg","w").write(
          f'<svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">\n'
          f'  <rect width="512" height="512" rx="{rx}" fill="{bg}"/>\n'
          f'  <path transform="{xform}" d="{d}" fill="{fg}"/>\n</svg>\n')
    open(f"{OUT}/../icon/uppsolut-icon-glyph.svg","w").write(
      f'<svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">'
      f'<path transform="{xform}" d="{d}" fill="currentColor"/></svg>\n')

    # ---- PNGs: flatten the glyph outline and fill with Pillow ----
    from fontTools.pens.basePen import BasePen
    class Flatten(BasePen):
        def __init__(self,gs):
            super().__init__(gs); self.contours=[]; self.cur=None; self.pos=(0,0)
        def _moveTo(self,p): self.cur=[p]; self.pos=p
        def _lineTo(self,p): self.cur.append(p); self.pos=p
        def _curveToOne(self,c1,c2,p):
            p0=self.pos
            for i in range(1,17):
                t=i/16; mt=1-t
                x=mt**3*p0[0]+3*mt*mt*t*c1[0]+3*mt*t*t*c2[0]+t**3*p[0]
                y=mt**3*p0[1]+3*mt*mt*t*c1[1]+3*mt*t*t*c2[1]+t**3*p[1]
                self.cur.append((x,y))
            self.pos=p
        def _qCurveToOne(self,c,p):
            p0=self.pos
            for i in range(1,13):
                t=i/12; mt=1-t
                x=mt*mt*p0[0]+2*mt*t*c[0]+t*t*p[0]
                y=mt*mt*p0[1]+2*mt*t*c[1]+t*t*p[1]
                self.cur.append((x,y))
            self.pos=p
        def _closePath(self):
            if self.cur: self.contours.append(self.cur); self.cur=None
    f=TTFont(sys.argv[1])
    try:
        from fontTools.varLib.instancer import instantiateVariableFont
        if "fvar" in f: instantiateVariableFont(f,{"wght":900},inplace=True)
    except Exception: pass
    gs=f.getGlyphSet(); gname=f.getBestCmap()[ord("U")]
    fp=Flatten(gs); gs[gname].draw(fp)
    def render(size, bg, fg, corner=0.225, uscale=1.0, SS=4):
        S=size*SS
        img=Image.new("RGBA",(S,S),(0,0,0,0)); dr=ImageDraw.Draw(img)
        r=int(corner*S)
        (dr.rounded_rectangle([0,0,S-1,S-1],radius=r,fill=bg+(255,)) if r>0
         else dr.rectangle([0,0,S-1,S-1],fill=bg+(255,)))
        polys=[]
        for c in fp.contours:
            pts=[]
            for (x,y) in c:
                X=(tx+x*s); Y=(ty - y*s)               # to 512 space, y-flip
                X=256+(X-256)*uscale; Y=256+(Y-256)*uscale
                pts.append((X*S/512.0, Y*S/512.0))
            polys.append(pts)
        # fill outer, punch holes by redrawing inner contours in bg
        # (Inter 'U' is a single contour, so a straight fill is correct)
        for p in polys: dr.polygon(p, fill=fg+(255,))
        return img.resize((size,size),Image.LANCZOS)
    for sz in (16,32,48): render(sz,CRIMSON,PLATINUM).save(f"{OUT}/favicon-{sz}x{sz}.png")
    render(180,CRIMSON,PLATINUM,corner=0).save(f"{OUT}/apple-touch-icon.png")
    render(192,CRIMSON,PLATINUM,corner=0).save(f"{OUT}/android-chrome-192x192.png")
    render(512,CRIMSON,PLATINUM,corner=0).save(f"{OUT}/android-chrome-512x512.png")
    render(512,CRIMSON,PLATINUM,corner=0,uscale=0.66).save(f"{OUT}/android-chrome-maskable-512x512.png")
    render(48,CRIMSON,PLATINUM).save(f"{OUT}/favicon.ico",sizes=[(16,16),(32,32),(48,48)])
    print("Baked exact Inter favicons + icons ->", OUT)

if __name__=="__main__": main()

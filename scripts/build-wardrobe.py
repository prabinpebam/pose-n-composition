"""Bake original studio garment patterns against the CC0 Female Body (numpy/scipy)."""
import json
import struct
from pathlib import Path
import numpy as np
from scipy.spatial import ConvexHull

ROOT = Path(__file__).resolve().parents[1]
glb = (ROOT / 'public/models/mannequin/Mannequin_Female.glb').read_bytes()
length = struct.unpack_from('<I', glb, 12)[0]
doc = json.loads(glb[20:20+length])
data = glb[28+length:]


def accessor(i):
    a = doc['accessors'][i]
    v = doc['bufferViews'][a['bufferView']]
    dtype = {5126: '<f4', 5125: '<u4', 5123: '<u2', 5121: 'u1'}[a['componentType']]
    width = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4}[a['type']]
    return np.frombuffer(data, dtype, a['count']*width,
                         v.get('byteOffset', 0)+a.get('byteOffset', 0)).reshape(-1, width)


p = next(m for m in doc['meshes'] if m['name'] == 'Body')['primitives'][0]
attrs = p['attributes']
pos = accessor(attrs['POSITION'])
tri = accessor(p['indices']).reshape(-1, 3)
x, y, z = pos.T
ax = abs(x)
bones = [doc['nodes'][i]['name'] for i in doc['skins'][0]['joints']]
names = np.array(bones)[accessor(attrs['JOINTS_0'])]
weights = accessor(attrs['WEIGHTS_0'])
normal = accessor(attrs['NORMAL'])
arm = sum(weights[:, k] * np.array([n.startswith(('upperarm', 'lowerarm', 'hand', 'thumb',
           'middle', 'index', 'ring', 'pinky')) for n in names[:, k]]) for k in range(4))
arm /= weights.sum(axis=1)
front = z > -.018


def mix(a, b, t):
    out = {i: w*(1-t) for i, w in a.items()}
    for i, w in b.items():
        out[i] = out.get(i, 0) + w*t
    return out


def smooth(a, b, value):
    t = np.clip((value-a)/(b-a), 0, 1)
    return t*t*(3-2*t)


def ridge(distance, width):
    """Compact bell with a quiet tangent at either end of its footprint."""
    return np.maximum(0, 1-(distance/width)**2)**2


def underarm_clearance(ease, tank):
    # The inner upper sleeve and outer ribs share a narrow gap when lowered.
    # Fade the allowance over the entire seam rather than imprinting fingers
    # or a particular pose into a panel.
    facing = (1-2*smooth(.3, .7, arm))*np.sign(x)*normal[:, 0]
    seam = (smooth(.105,.141,ax)*smooth(.02,.64,facing) *
            smooth(1.12,1.231,y)*smooth(1.434,1.346,y))
    axilla = (smooth(.101,.142,ax)*smooth(.191,.161,ax)*
              smooth(1.188,1.25,y)*smooth(1.389,1.345,y)*
              smooth(.085,.056,abs(z+.031)))
    seam = np.maximum(seam, axilla)
    return ease*(1-seam)+(.0015 if tank else .0019)*seam


def shell_ease(name, field):
    tank, coat = name == 'tank', name == 'trench'
    free = smooth(.003, .035 if tank else .045, field)
    # Back and front do not share fold lines across the side seam.
    face = smooth(-.032, .045, z)
    skew = .008*np.sign(x)
    if tank:
        flank = ridge(ax-.079, .093)
        waist = ridge(y-1.144, .125)
        # Jersey catches over one hip and fans out; leave bust and binding quiet.
        fans = (.0046*ridge(y-(1.082+.48*ax+skew), .019)
                + .0035*ridge(y-(1.141+.27*ax+skew), .016))
        back = .0034*ridge(y-(1.107+.48*ax-skew), .023)
        return underarm_clearance(.004 + free*(.0028*waist + flank*(face*fans+(1-face)*back)), True)

    sleeve = smooth(.35, .68, arm)
    # Two oblique compression tucks meet opposite sides of the elbow. Their
    # ends die out rather than making concentric rings around the whole arm.
    front_arm = smooth(-.062, -.004, z)
    elbow = 1.157 + .68*(ax-.188) + skew
    crown = (.017 if coat else .023)*ridge(y-elbow, .035)*front_arm
    return_tuck = (.012 if coat else .018)*ridge(y-elbow+.066+.95*(ax-.188), .031)*(1-.75*front_arm)
    cuff = (.008 if coat else .013)*ridge(y- (.969-.60*(ax-.195)), .025)*front_arm
    sleeve_slack = (.006 if coat else .009)*ridge(y-1.112, .237)
    # Keep the inside of the lowered arm clear of the torso.
    outside = smooth(.15, .208, ax)
    sleeve_shape = (.18+.82*outside)*(crown+return_tuck+cuff+sleeve_slack)

    flank = ridge(ax-.091, .092)
    if coat:
        # The chest panel falls towards the belt; tension comes from that
        # fixed point, not evenly spaced folds across the leather-like lapel.
        body = (.010*ridge(y-1.202, .145) +
                flank*.013*ridge(y-(1.072+.92*ax+skew), .032) +
                (1-face)*.009*ridge(ax-(.055+.24*(y-1.14)), .031)*ridge(y-1.23, .16))
    else:
        body = (.011*ridge(y-1.176, .139) +
                flank*(.016*ridge(y-(1.104+.44*ax+skew), .026) +
                       .011*ridge(y-(1.19-.39*ax+skew), .023)) +
                face*.006*ridge(ax-.053, .029)*ridge(y-1.248, .097))
    # The band overlaps the skirt waistband. Its outside edge must remain
    # outside the skirt, even where the main body blouses into the band.
    base = (.014 if coat else .012) + .009*ridge(y-1.089, .049)*(1-sleeve)
    return underarm_clearance(base + free*((1-sleeve)*body+sleeve*sleeve_shape), False)


def loft_fold(level, angle, coat):
    a = (angle+np.pi) % (2*np.pi)-np.pi
    side = abs(a)
    if coat:
        # Three hanging flutes per side. They converge at the belt and fan
        # towards the hem; the quieter front edge stays open and untwisted.
        fall = smooth(1.061, .55, level)
        stations = ((.75+.14*fall, .22, .019), (2.04+.16*fall, .32, .025),
                    (2.72-.12*fall, .26, .033))
        return fall * sum(amp*ridge(side-center-.04*np.sign(a)*fall, width)
                          for center, width, amp in stations)
    # Pencil cloth stays fitted over the thighs. Short diagonal pleats pull
    # from the high hip, with a shallower second crease under the waistband.
    front_hip = ridge(side-.96, .99)
    back_hip = ridge(side-2.41, .68)
    bias = .012*np.sin(a)
    return (front_hip*(.011*ridge(level-(.928+.056*side+bias), .032)
                       + .007*ridge(level-(1.009+.034*side+bias), .025))
            + back_hip*.007*ridge(level-(.966+.048*(side-2.4)), .032))


class FrontDrape:
    """Bridge hollow chest/underbust regions between supports, not into the skin."""
    def __init__(self, tank):
        self.tank = tank
        self.sides = []
        for sign in (-1, 1):
            # A closed tank spans the sternum; open garments use independent
            # supports on either side of the placket. Never attach to an arm.
            ids = np.flatnonzero((y > 1.068) & (y < 1.427) & (arm < .1) &
                                 (z > -.015) & (sign*x > (-1 if tank else .001)))
            hull = ConvexHull(pos[ids])
            # Project slightly upwards from below so the overhanging lower
            # bust isn't folded back on itself by a straight front projection.
            self.direction = np.array([0., -.53, 1.])
            denom = hull.equations[:, :3] @ self.direction
            keep = denom > .02
            planes = hull.equations[keep]/denom[keep, None]
            self.sides.append((ids[hull.simplices[keep]], planes))

    def bind(self, weights, ease):
        origin = sum(pos[i]*w for i, w in weights.items())
        xx, yy, zz = origin
        factor = (.67 if self.tank else .97)*smooth(.010, .062, zz) * \
            smooth(1.076, 1.15, yy)*smooth(1.424, 1.363, yy)*smooth(.148, .105, abs(xx))
        if factor <= 0:
            return weights
        faces, planes = self.sides[int(xx >= 0)]
        lifts = -planes[:, 3]-planes[:, :3] @ origin
        lift = lifts.min()
        if lift <= 0:
            return weights
        # Coplanar hull facets share the same ray distance. Select the
        # triangle containing the hit, not the first facet on the plane.
        for face in np.flatnonzero(lifts < lift+1e-6):
            ids = faces[face]
            a,b,c = pos[ids]
            uv = np.linalg.lstsq(np.column_stack((a-c,b-c)), origin+lift*self.direction-c, rcond=None)[0]
            coeff = np.r_[uv, 1-uv.sum()]
            if min(coeff) >= -1e-5:
                break
        else:
            return weights
        result = mix(weights, dict(zip(ids, coeff)), factor*smooth(0, .006, lift))
        result = {i:w for i,w in result.items() if w > 1e-9}
        # A clipped edge mixed with a support triangle may have >4 donors.
        # Remove affine dependencies while preserving the eased rest point.
        while len(result) > 4:
            ids, ws = map(np.array, zip(*result.items()))
            samples = pos[ids] + ease*normal[ids]
            mat = np.vstack([samples.T, np.ones(len(ws))])
            kernel = np.linalg.svd(mat)[2][-1]
            positive = kernel > 1e-9
            ws -= kernel * np.min(ws[positive]/kernel[positive])
            result = {i:w for i,w in zip(ids, ws) if w > 1e-9}
        return result


class Pattern:
    def __init__(self):
        self.vertices, self.faces, self.keys = [], [], {}
        self.panel = []
        self.drape = None

    def vertex(self, weights, ease):
        pairs = sorted((int(i), round(w, 6)) for i, w in weights.items() if w > .000001)
        key = (*pairs, round(ease, 5))
        if key not in self.keys:
            if self.drape:
                pairs = sorted(self.drape.bind(dict(pairs), ease).items())
            ids, ws = zip(*pairs)
            self.keys[key] = len(self.vertices)
            self.vertices.append(struct.pack('<4H4Hh', *(ids+(0,)*(4-len(ids))),
                                 *([round(w*65535) for w in ws]+[0]*(4-len(ws))), round(ease*10000)))
        return self.keys[key]

    def shell(self, field, ease, material, trim_width=0):
        """Clip triangles to pattern edges rather than quantizing hems to body topology."""
        for face in tri[np.max(field[tri], axis=1) > 0]:
            poly = []
            for i, j in zip(face, np.roll(face, -1)):
                if field[i] >= 0:
                    poly.append({i: 1})
                if (field[i] < 0) != (field[j] < 0):
                    t = field[i]/(field[i]-field[j])
                    poly.append({i: 1-t, j: t})
            def add_polygon(corners, mat):
                ids = [self.vertex(w, sum(ease[k]*v for k, v in w.items())) for w in corners]
                for j in range(1, len(ids)-1):
                    self.faces.append((mat, ids[0], ids[j], ids[j+1]))
            if not trim_width:
                add_polygon(poly, material)
            else:
                # Split the *clipped* polygon so body, binding and opening share edges.
                inner, binding = [], []
                for a, b in zip(poly, poly[1:] + poly[:1]):
                    fa, fb = (sum(field[k]*w for k, w in c.items())-trim_width for c in (a, b))
                    (inner if fa >= 0 else binding).append(a)
                    if (fa < 0) != (fb < 0):
                        edge = mix(a, b, fa/(fa-fb))
                        inner.append(edge)
                        binding.append(edge)
                add_polygon(inner, material)
                add_polygon(binding, 1)

    def loft(self, levels, coat, arc=None, segments=64, panel=False):
        # A taut horizontal cloth section bridges the legs, but each end of the
        # bridge remains bound to its own thigh (also through proportion edits).
        prev = None
        for level, ease, material in levels:
            crossing = tri[(y[tri].min(axis=1) <= level) & (y[tri].max(axis=1) > level)
                           & (arm[tri].max(axis=1) < .35)]
            points, binds = [], []
            for face in crossing:
                for i, j in zip(face, np.roll(face, -1)):
                    if (y[i] <= level) != (y[j] <= level):
                        t = (level-y[i])/(y[j]-y[i])
                        points.append((pos[i]*(1-t)+pos[j]*t)[[0, 2]])
                        binds.append({i: 1-t, j: t})
            points = np.array(points)
            hull = ConvexHull(points).vertices
            center = (points.min(axis=0)+points.max(axis=0))*.5
            gap = np.interp(level, [.43, .84, 1.11], [.48, .36, .29]) if coat else 0
            row = []
            start, end = arc(level) if arc else (gap, 2*np.pi-gap)
            for a in np.linspace(start, end, segments+1):
                d = np.array([np.sin(a), np.cos(a)])
                for i, j in zip(hull, np.roll(hull, -1)):
                    u = points[i]-center
                    v = points[j]-points[i]
                    cross = lambda a, b: a[0]*b[1]-a[1]*b[0]
                    det = cross(d, v)
                    if abs(det) < 1e-12:
                        continue
                    t = cross(u, d)/det
                    if -.000001 <= t <= 1.000001 and cross(u, v)/det > 0:
                        fold = loft_fold(level, a, coat) if panel else 0
                        # A pencil side seam follows the thigh. Keep lower
                        # coat volume off the hand path, in front/rear pleats.
                        side = ridge(abs(np.sin(a))-1, .27)*ridge(level-.821, .173)
                        allowance = ease+fold-side*(.020 if coat else .010)
                        row.append(self.vertex(mix(binds[i], binds[j], np.clip(t, 0, 1)), allowance))
                        break
            assert len(row) == segments+1
            if panel and level <= (.884 if coat else 1.088):  # Keep fitted pocket welts & waistband fixed.
                self.panel.append(row)
            if prev:
                for k in range(segments):
                    mat = 1 if coat and not arc and k in (0, segments-1) else material
                    self.faces.extend([(mat, prev[k], prev[k+1], row[k]),
                                       (mat, prev[k+1], row[k+1], row[k])])
            prev = row

    def save(self, name):
        out = ROOT/'src/wardrobe-assets'
        out.mkdir(exist_ok=True)
        faces = sorted(self.faces)
        groups = np.bincount([f[0] for f in faces], minlength=4)
        indices = np.array([f[1:] for f in faces], dtype='<u2')
        assert len(self.vertices) < 65536
        panel = np.array(self.panel, dtype='<u2')
        records = np.frombuffer(b''.join(self.vertices), '<u2').reshape(-1, 9).copy()
        durations = b''
        if len(panel):
            record = records[panel]
            samples = pos[record[:,:,:4]] + accessor(attrs['NORMAL'])[record[:,:,:4]]*record[:,:,8,None,None]/10000
            points = (samples * (record[:,:,4:8,None]/65535)).sum(axis=2)
            # Store original edge lengths (0.01mm), not references to either leg's bones.
            lengths = [np.linalg.norm(np.diff(points, axis=k, prepend=np.take(points,[0],axis=k)),axis=2)
                       for k in (0,1)]
            durations = np.round(np.stack(lengths,axis=-1)*100000).astype('<u2').tobytes()
        (out/(name+'.bin')).write_bytes(struct.pack('<6I', len(pos), len(self.vertices), *groups)
                                        + records.tobytes()+indices.tobytes()
                                        + struct.pack('<2H', len(panel), panel.shape[1] if len(panel) else 0)
                                        + panel.tobytes() + durations)
        print(name, len(self.vertices), 'vertices', len(faces), 'triangles')


def build():
    for name in ('tank', 'jacket', 'trench', 'skirt'):
        g = Pattern()
        if name != 'skirt':
            tank, coat = name == 'tank', name == 'trench'
            hem = 1.015 if tank else 1.075 if coat else 1.08
            gap = np.interp(y, [1.08, 1.26, 1.42, 1.49], [.043, .034, .057, .060])
            neck = np.where(front, 1.315 if tank else 1.395, 1.402 if tank else 1.463)
            neck = neck + (.16 if tank else .09)*(ax/(.081 if tank else .071))**2
            armhole = np.interp(y, [1.255, 1.31, 1.43, 1.50], [.19, .15, .109, .100])
            field = np.minimum(neck-y, 1.505-y)
            if tank:
                field = np.minimum.reduce([field, y-hem, .40-arm, armhole-ax])
            else:
                field = np.minimum(field, np.maximum(np.minimum(y-hem, .5-arm),
                                                    np.minimum(arm-.49, y-.91)))
                field = np.minimum(field, np.where(front, ax-(gap if coat else .013), 1))
            ease = shell_ease(name, field)
            g.drape = FrontDrape(tank)
            # Knit binding, jacket ribbing and raincoat cuff welts have raised edges.
            g.shell(field, ease, 0, .005 if tank else .009 if coat else .021)
            if coat:
                # Folded peak lapels: two notches in the broad end; raised roll line.
                width = np.interp(y, [1.223, 1.37, 1.392, 1.403, 1.421, 1.47],
                                  [0, .054, .066, .038, .062, .014])
                u = ax-gap
                lapel = np.minimum.reduce([field, np.where(front, 1., -1.), y-1.223, 1.47-y,
                                           u+.002, width-u])
                across = np.clip(u/(width+.001), 0, 1)
                roll = (.014*ridge(across-.25, .62) + .007*(1-across))
                g.shell(lapel, ease+.004+roll*smooth(1.223, 1.277, y), 2)
            g.drape = None
        if name in ('skirt', 'trench'):
            coat = name == 'trench'
            levels = np.unique(np.r_[np.linspace(.433 if coat else .51, 1.088, 30),
                                     [1.09, 1.104, 1.111] if not coat else [1.097]])
            g.loft([(h, np.interp(h, [.433, .51, .74, .9, 1.04, 1.111],
                                  [.076, .066, .040, .027, .026, .016] if coat else
                                  [.030, .023, .021, .013, .012, .012]) +
                     (.002 if h > 1.088 else 0), 1 if h > 1.088 or h < levels[1]+.0001 else 0)
                    for h in levels], coat, panel=True)
            if coat:
                # Split belt and pocket welts sit above the skirt and the coat waist join.
                g.loft([(h, e, 1) for h, e in [(1.059,.019), (1.060,.030), (1.063,.034),
                                                (1.099,.032), (1.102,.030), (1.105,.013)]], True)
                for sign in (-1, 1):
                    g.loft([(h,.034,1) for h in np.linspace(.898,.954,8)], True,
                           lambda h: (sign*(.92+(.954-h)*4)-.032, sign*(.92+(.954-h)*4)+.032), 3)
                # Brass buttons on the unfastened placket: loft small domed discs.
                for cy in (.925, 1.019, 1.081):
                    for sign in (-1, 1):
                        disc = lambda h: .049*np.sqrt(max(.002, 1-((h-cy)/.006)**2))
                        g.loft([(h, (.040 if cy > 1.06 else .034)+.003*disc(h)/.049, 3)
                                for h in np.linspace(cy-.006,cy+.006,7)], True,
                               lambda h: (sign*.72-disc(h), sign*.72+disc(h)), 5)
        g.save(name)


if __name__ == '__main__':
    build()

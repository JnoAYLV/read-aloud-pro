// The highlight drawn over another program: name and word-group hits in their own colours (bottom),
// a soft band on the sentence being read, and a stronger box on the word being spoken (top).
window.rapDraw = ({ s = [], w = [], t = [] }) => {
  document.body.replaceChildren();
  const add = (r, cls, color) => {
    const d = document.createElement('div'); d.className = cls;
    Object.assign(d.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
    if (color && /^#[0-9a-f]{6}$/i.test(color)) { d.style.background = color + '59'; d.style.borderBottom = '2px solid ' + color; }
    document.body.appendChild(d);
  };
  t.forEach(g => g.r.forEach(r => add(r, 't', g.c)));
  s.forEach(r => add(r, 's')); w.forEach(r => add(r, 'w'));
};

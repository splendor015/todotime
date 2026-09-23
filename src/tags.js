export const TAG_PRESETS = [
  { name: '课程', color: '#3979b8', background: '#e9f2fb' },
  { name: '运动', color: '#37875d', background: '#eaf5ed' },
  { name: '吃饭', color: '#cb7042', background: '#fbefe8' },
  { name: '工作', color: '#6856a5', background: '#f0edfa' },
  { name: '学习', color: '#27838a', background: '#e7f4f3' },
  { name: '休息', color: '#ad5e83', background: '#f8edf2' },
  { name: '出行', color: '#947329', background: '#f8f2df' },
  { name: '家务', color: '#65765a', background: '#eff3e9' },
];

export const tagStyle = (name) => {
  const preset = TAG_PRESETS.find(tag => tag.name === name);
  return preset
    ? { color: preset.color, backgroundColor: preset.background }
    : { color: '#596d6b', backgroundColor: '#edf2f1' };
};

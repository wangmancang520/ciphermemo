import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
try {
  await writeFile('.dev.vars', `SETUP_TOKEN=${randomBytes(32).toString('base64url')}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  console.log('已生成 .dev.vars；首次初始化时从该文件复制 SETUP_TOKEN。此文件已被 Git 忽略。');
} catch (error) {
  if (error.code === 'EEXIST') console.log('.dev.vars 已存在，未覆盖。');
  else throw error;
}

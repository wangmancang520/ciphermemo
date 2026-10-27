import { describe, it, expect } from 'vitest';
import {
  attachmentIdFromSrc,
  attachmentRefs,
  imageMarkdown,
  previewText,
  remapAttachmentRefs,
} from '../src/client/inlineImages';
import { markdownRoundTrip, richEditable } from '../src/client/richSchema';

const a = '0b0c7f4e-2c3a-4d55-9a1b-1234567890ab';
const b = '7d1e2f30-4a5b-4c6d-8e9f-a0b1c2d3e4f5';
const c = 'f0e1d2c3-b4a5-4697-8879-6a5b4c3d2e1f';

describe('行内图片引用', () => {
  it('只识别附件引用，忽略外部图片和格式不正确的标识', () => {
    const body = `![甲](attachment:${a})\n![](https://example.com/x.png)\n![乙](attachment:${b} "标题")\n![丙](attachment:not-an-id)`;
    expect([...attachmentRefs(body)]).toEqual([a, b]);
    expect(attachmentIdFromSrc(`attachment:${a}`)).toBe(a);
    expect(attachmentIdFromSrc('https://example.com/x.png')).toBeNull();
    expect(attachmentIdFromSrc(`attachment:${a}x`)).toBeNull();
  });

  it('导入备份时按新标识改写引用，未知标识保持不变', () => {
    const body = `前文 ![图](attachment:${a}) 中间 ![图](attachment:${b})\n\n\`attachment:${a}\``;
    const out = remapAttachmentRefs(body, new Map([[a, c]]));
    expect(out).toBe(
      `前文 ![图](attachment:${c}) 中间 ![图](attachment:${b})\n\n\`attachment:${a}\``,
    );
  });

  it('生成的 Markdown 可被重新识别，文件名中的方括号不会截断', () => {
    const md = imageMarkdown(a, '截图 [1].png');
    expect(md).toBe(`![截图 1.png](attachment:${a})`);
    expect([...attachmentRefs(md)]).toEqual([a]);
  });

  it('列表预览去掉格式符号', () => {
    expect(
      previewText(
        '## 本周计划\n\n这是**重点**和~~删除~~、`代码`。\n\n> 引用\n\n- [ ] 买菜\n- [x] 洗衣服\n\n[链接](https://example.com)',
        '图片',
      ),
    ).toBe('本周计划\n\n这是重点和删除、代码。\n\n引用\n\n- 买菜\n- 洗衣服\n\n链接');
  });

  it('列表预览用简短标记代替原始引用', () => {
    expect(previewText(`看这里 ![海报.png](attachment:${a}) 和 ![](attachment:${b})`, '图片')).toBe(
      '看这里 [图片: 海报.png] 和 [图片]',
    );
  });
});

describe('富文本与 Markdown 往返', () => {
  it('常见笔记写法在富文本模式下保持含义', () => {
    for (const body of [
      '',
      '第一行\n第二行',
      '把一闪而过的想法留在这里。\n\n今天想做的三件小事：\n\n- 整理读书笔记\n- 开始一个新项目',
      '今天想做的三件小事：\n- 整理读书笔记\n- 开始一个新项目',
      '* 星号列表\n* 第二项',
      '# 标题\n\n**粗体**、__粗体__、*斜体*、_斜体_、~~删除~~、`代码`',
      '1. 一\n2. 二\n\n> 引用',
      '- [ ] 待办\n- [x] 已完成',
      '| 名称 | 数量 |\n| - | - |\n| 牛奶 | 2 |',
      '```js\nconst a = 1;\n```',
      `前文\n\n![截图.png](attachment:${a})\n\n后文`,
      '[链接](https://example.com)',
    ])
      expect(richEditable(body), body).toBe(true);
  });

  it('含有富文本无法表示的内容时改用源码模式，避免保存时被改写', () => {
    expect(richEditable('<b>原始 HTML</b>')).toBe(false);
    expect(richEditable('脚注[^1]\n\n[^1]: 说明')).toBe(false);
  });

  it('行内图片引用在往返后保持原样', () => {
    const body = `![海报.png](attachment:${a})`;
    expect(markdownRoundTrip(body)).toContain(`attachment:${a}`);
  });
});

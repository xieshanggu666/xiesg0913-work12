/**
 * 帧标注：依附于轨迹帧号的文字注记。
 * 与轨迹文件完全分离——标注有独立的文件格式（kind 不同），
 * 添加 / 删除 / 导出 / 导入标注都不改写轨迹帧内容；
 * 旧版轨迹文件不含任何标注字段，导入后标注列表为空、回放不受影响。
 * 纯函数、无 DOM 依赖，导入解析失败时抛出带中文说明的 AnnotationParseError。
 */

export interface FrameAnnotation {
  id: number
  /** 轨迹帧号（0 起，与回放时间轴当前帧一致） */
  frame: number
  text: string
}

export const ANN_FILE_KIND = 'glass-forge-annotations'
export const ANN_FILE_VERSION = 1
/** 单条标注字数上限（与输入框 maxLength 一致） */
export const MAX_ANNOTATION_TEXT = 200

/** 标注文件损坏 / 格式不符时抛出，message 面向用户 */
export class AnnotationParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AnnotationParseError'
  }
}

interface AnnotationFile {
  kind: typeof ANN_FILE_KIND
  version: number
  /** 导出时轨迹的总帧数，导入方据此核对标注与轨迹是否配套 */
  frameCount: number
  annotations: Array<{ frame: number; text: string }>
}

/** 按帧号升序、同帧按添加先后排列 */
function sorted(list: FrameAnnotation[]): FrameAnnotation[] {
  return list.slice().sort((a, b) => (a.frame !== b.frame ? a.frame - b.frame : a.id - b.id))
}

/** 追加一条标注（id 取现有最大 id + 1，删除后不复用），返回排序后的新数组 */
export function addFrameAnnotation(
  list: FrameAnnotation[],
  frame: number,
  text: string
): FrameAnnotation[] {
  const id = list.reduce((m, a) => Math.max(m, a.id), 0) + 1
  return sorted([...list, { id, frame, text }])
}

export function removeFrameAnnotation(list: FrameAnnotation[], id: number): FrameAnnotation[] {
  return list.filter((a) => a.id !== id)
}

export function annotationsAtFrame(list: FrameAnnotation[], frame: number): FrameAnnotation[] {
  return list.filter((a) => a.frame === frame)
}

export function serializeAnnotations(list: FrameAnnotation[], frameCount: number): string {
  const file: AnnotationFile = {
    kind: ANN_FILE_KIND,
    version: ANN_FILE_VERSION,
    frameCount,
    annotations: sorted(list).map((a) => ({ frame: a.frame, text: a.text }))
  }
  return JSON.stringify(file)
}

/** 解析并校验标注文件；id 重新顺次编号，返回按帧号排序的全新对象（不引用文件里的数据） */
export function parseAnnotations(text: string): {
  frameCount: number
  annotations: FrameAnnotation[]
} {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new AnnotationParseError('文件不是有效的 JSON，可能已损坏或被截断')
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new AnnotationParseError('文件内容不是标注对象，可能已损坏')
  }
  const file = data as Record<string, unknown>
  if (file.kind !== ANN_FILE_KIND) {
    throw new AnnotationParseError('这不是琉璃工房的标注文件（缺少 kind 标记）')
  }
  if (typeof file.version !== 'number') {
    throw new AnnotationParseError('标注文件缺少版本号，可能已损坏')
  }
  if (file.version > ANN_FILE_VERSION) {
    throw new AnnotationParseError(
      `标注文件版本（v${file.version}）高于当前应用支持的 v${ANN_FILE_VERSION}，请升级应用`
    )
  }
  if (
    typeof file.frameCount !== 'number' ||
    !Number.isInteger(file.frameCount) ||
    file.frameCount < 0
  ) {
    throw new AnnotationParseError('标注文件缺少轨迹帧数（frameCount），可能已损坏')
  }
  if (!Array.isArray(file.annotations)) {
    throw new AnnotationParseError('标注文件缺少标注列表（annotations），可能已损坏')
  }
  const annotations = file.annotations.map((raw, i) => validateAnnotation(raw, i))
  return { frameCount: file.frameCount, annotations: sorted(annotations) }
}

function validateAnnotation(raw: unknown, index: number): FrameAnnotation {
  const where = `第 ${index + 1} 条标注`
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new AnnotationParseError(`${where}数据损坏：不是标注对象`)
  }
  const a = raw as Record<string, unknown>
  if (typeof a.frame !== 'number' || !Number.isInteger(a.frame) || a.frame < 0) {
    throw new AnnotationParseError(`${where}数据损坏：帧号 frame 必须是不小于 0 的整数`)
  }
  if (typeof a.text !== 'string' || a.text.trim().length === 0) {
    throw new AnnotationParseError(`${where}数据损坏：标注内容为空`)
  }
  if (a.text.length > MAX_ANNOTATION_TEXT) {
    throw new AnnotationParseError(`${where}数据损坏：标注超过 ${MAX_ANNOTATION_TEXT} 字`)
  }
  // id 按文件顺序重新编号，不采用文件里可能伪造的 id
  return { id: index + 1, frame: a.frame, text: a.text.trim() }
}

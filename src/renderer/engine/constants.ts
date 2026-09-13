/** 物理与仿真常量——所有“手感”旋钮集中在此，便于艺术家调参。 */

/** 剖面站点数（回转体只用一条母线，25 站足够平滑） */
export const N_STATIONS = 25

export const T_ROOM = 20
/** 初始料泡（gather）温度 */
export const T_GATHER = 900
/** 软化区间：低于下限基本不可塑，高于上限接近自由流动 */
export const T_SOFT_LO = 620
export const T_SOFT_HI = 980
/** 退火温度：高于此值残余应力会快速松弛 */
export const T_ANNEAL = 520
/** 脆裂区间中值，附近快速冷却最容易炸 */
export const T_BRITTLE = 380

export const TEMP_FLAME_MIN = 400
export const TEMP_FLAME_MAX = 1200
export const SPIN_MAX = 120

/** 初始球体半径（世界坐标，画布高度约 3.2） */
export const R_SPHERE = 0.34
/** 半径下限（尖端不可能收到 0，避免乘法退化） */
export const R_MIN = 0.045
export const R_MAX = 1.6
export const T_MIN = 0.018
export const T_MAX = 0.5

/** 裂纹萌生的应力阈值 */
export const STRESS_CRACK = 75
/** 裂纹完全贯穿（整件报废） */
export const CRACK_FAIL = 1

/** 固定仿真步长：回放要逐帧复现，不能随帧率浮动 */
export const FIXED_DT = 1 / 30
/** 最多录制 20 分钟，防止内存无限增长 */
export const MAX_TRAJ = FIXED_DT * 36000

export const TOOL_LABELS: Record<string, string> = {
  flame: '火焰',
  blow: '吹管',
  pull: '拉制',
  marver: '炭铲',
  cool: '风冷'
}

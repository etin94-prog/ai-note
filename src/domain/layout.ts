const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** 겹치는 일정은 같은 묶음 안에서 칸(lane)을 나눠 나란히 배치 */
export function layoutLanes(items: { key: string; start: string; end: string }[]) {
  const sorted = [...items].sort((a, b) => toMin(a.start) - toMin(b.start) || toMin(b.end) - toMin(a.end));
  const result = new Map<string, { lane: number; lanes: number }>();
  let cluster: { key: string; lane: number }[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -1;
  const flush = () => {
    for (const c of cluster) result.set(c.key, { lane: c.lane, lanes: laneEnds.length });
    cluster = [];
    laneEnds = [];
  };
  for (const it of sorted) {
    const s = toMin(it.start);
    const e = toMin(it.end);
    if (s >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= s);
    if (lane === -1) lane = laneEnds.push(e) - 1;
    else laneEnds[lane] = e;
    cluster.push({ key: it.key, lane });
    clusterEnd = Math.max(clusterEnd, e);
  }
  flush();
  return result;
}

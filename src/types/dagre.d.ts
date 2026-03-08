declare module 'dagre' {
  export namespace graphlib {
    type GraphLabel = Record<string, unknown>;

    class Graph {
      constructor(opts?: { directed?: boolean; multigraph?: boolean; compound?: boolean });
      setGraph(label: GraphLabel): this;
      setDefaultEdgeLabel(labelFn: () => GraphLabel): this;
      setNode(name: string, label: GraphLabel): this;
      setEdge(v: string, w: string, label?: GraphLabel): this;
      node(name: string): { x: number; y: number; width: number; height: number };
      graph(): GraphLabel;
    }
  }
  export function layout(graph: graphlib.Graph): void;
}

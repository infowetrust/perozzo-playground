type TitleBlockUSAProps = {
  x: number;
  y: number;
  style: {
    text: string;
  };
  legend: {
    ages: string;
    values: string;
    cohorts: string;
    years: string;
    quadrants: string;
    thin: number;
    thick: number;
  };
  title?: {
    bigWord?: string;
    years?: string;
  };
};

const block = {
  width: 170,
  gap: 5,
  fontFamily: "Garamond, serif",
  fontWeight: "normal",
  sizeTiny: 8,
  sizeSmall: 10,
  sizeLarge: 19,
  lines: [
    "POPULATION",
    "",
    "by AGE from",
    "",
    "CENSUS RESULTS",
    "",
    "of the",
  ],
  bigWord: "UNITED STATES",
  years: "1900–2025",
};

export const TITLE_BLOCK_USA_WIDTH = block.width;
export const TITLE_BLOCK_USA_HEIGHT =
  block.lines.length * block.gap +
    block.sizeLarge +
    block.gap * 6 +
    block.sizeSmall;

export default function TitleBlockUSA({
  x,
  y,
  style,
  legend,
  title,
}: TitleBlockUSAProps) {
  const bigWord = title?.bigWord ?? block.bigWord;
  const years = title?.years ?? block.years;
  const legendItems = [
    { label: "Census", color: legend.years },
    { label: "Age", color: legend.ages },
    { label: "Cohort", color: legend.cohorts },
    { label: "Isoline", color: legend.values },
    { label: "Quartile", color: legend.quadrants },
  ];

  const itemWidth = block.width / legendItems.length;
  const legendThin = legend.thin * 2;
  const legendThick = legend.thick * 2.5;
  const lineLength = itemWidth * 0.7;

  return (
    <g transform={`translate(${x}, ${y})`}>
      <g
        fill={style.text}
        fontFamily={block.fontFamily}
        fontWeight={block.fontWeight}
        textAnchor="middle"
      >
        {block.lines.map((line, idx) => (
          <text
            key={`line-${idx}`}
            x={block.width / 2}
            y={idx * block.gap}
            fontSize={block.sizeSmall}
          >
            {line}
          </text>
        ))}
        <text
          x={block.width / 2}
          y={block.lines.length * block.gap + block.sizeLarge - block.gap}
          fontSize={block.sizeLarge}
          letterSpacing={1.5}
        >
          {bigWord}
        </text>
        <text
          x={block.width / 2}
          y={block.lines.length * block.gap + block.sizeLarge + block.gap * 2}
          fontSize={block.sizeTiny}
          fontWeight={"bold"}
        >
          {years}
        </text>
      </g>

      <g
        transform={`translate(0, ${block.lines.length * block.gap + block.sizeLarge + block.gap * 5
          })`}
      >
        {legendItems.map((item, idx) => (
          <g
            key={item.label}
            transform={`translate(${idx * itemWidth}, 0)`}
            fontFamily={block.fontFamily}
            fontWeight={block.fontWeight}
            textAnchor="middle"
          >
            <line
              x1={itemWidth / 2 - lineLength / 2}
              y1={0}
              x2={itemWidth / 2 + lineLength / 2}
              y2={0}
              stroke={item.color}
              strokeWidth={legendThick}
              strokeLinecap="butt"
            />
            <line
              x1={itemWidth / 2 - lineLength / 2}
              y1={4}
              x2={itemWidth / 2 + lineLength / 2}
              y2={4}
              stroke={item.color}
              strokeWidth={legendThin}
              strokeLinecap="butt"
            />
            <text
              x={itemWidth / 2}
              y={15}
              fontSize={block.sizeTiny}
              fill={style.text}
            >
              {item.label}
            </text>
          </g>
        ))}
      </g>
    </g>
  );
}

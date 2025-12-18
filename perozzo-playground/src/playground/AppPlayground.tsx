import PlateViz from "./PlateViz";
import swedenCsv from "../data/porozzo-tidy.csv?raw";
import contourRaw from "../data/porozzo-contours.json";

export default function AppPlayground() {
  return (
    <PlateViz
      csvText={swedenCsv}
      contours={contourRaw}
      preset="levasseur"
      showUI
    />
  );
}

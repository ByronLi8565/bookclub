import type { RenderSnapshot } from "./renderSnapshot.ts";
import type React from "react";

export function ReaderSnapshot({ snapshot }: { snapshot: RenderSnapshot }): React.ReactElement {
  return (
    <div className="reader-snapshot" aria-hidden="true">
      <img
        src={snapshot.dataUrl}
        width={snapshot.width}
        height={snapshot.height}
        alt=""
        draggable={false}
      />
    </div>
  );
}

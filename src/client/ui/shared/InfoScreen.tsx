import { useState } from "react";
import type { InfoCardPage } from "../../logic/info/infoCards.ts";
import { infoCards } from "../../logic/info/infoCards.ts";
import { NoteCardView } from "../notes/NoteThread.tsx";
import { Modal, ModalPagerTabs } from "./Modal.tsx";

const EMPTY_REFS = new Map<number, string>();
const PAGES: { id: InfoCardPage; label: string; empty: string }[] = [
  { id: "info", label: "INFO", empty: "no info cards yet" },
  { id: "release", label: "RELEASE LOG", empty: "no release cards yet" },
];

export function InfoScreen({ onClose }: { onClose: () => void }): React.ReactElement {
  const [page, setPage] = useState<InfoCardPage>("info");
  const activePage = PAGES.find((p) => p.id === page) ?? PAGES[0];
  const cards = infoCards.filter((card) => card.page === page);

  return (
    <Modal title={activePage.label} className="home-info-panel" onClose={onClose}>
      <div className="modal-body note-panel home-info-cards">
        {cards.length === 0 ? (
          <p className="home-info-empty">{activePage.empty}</p>
        ) : (
          <ul>
            {cards.map((card, index) => (
              <li key={card.path} title={card.title}>
                <NoteCardView
                  seq={index + 1}
                  title={card.title}
                  body={card.body}
                  refs={EMPTY_REFS}
                  onReference={() => {}}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
      <ModalPagerTabs tabs={PAGES} active={page} onChange={setPage} className="settings-tabs" />
    </Modal>
  );
}

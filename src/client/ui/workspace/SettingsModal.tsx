import { useState } from "react";
import {
  setNotesPref,
  setReaderPref,
  useNotesPrefs,
  useReaderPrefs,
  type PdfPageLayout,
  type ReadingPositionOpenPolicy,
  type SmartArrows,
} from "../../logic/settings/userPrefs.ts";
import { AccountSettings } from "../shared/AccountSettings.tsx";
import { DropdownMenu, type DropdownTriggerProps } from "../shared/DropdownMenu.tsx";
import { Modal, ModalPagerTabs } from "../shared/Modal.tsx";
import type { ClubProfile } from "../../../shared/types/profiles.ts";
import { UserSettings } from "./UserSettings.tsx";

function SettingDropdown<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  ariaLabel: string;
}): React.ReactElement {
  const active = options.find((o) => o.value === value);

  return (
    <DropdownMenu
      className="book-menu settings-dropdown"
      items={options.map((option) => ({
        key: option.value,
        label: option.label,
        title: option.label,
        checked: option.value === value,
        className: option.value === value ? "book-menu-item is-active" : "book-menu-item",
        onSelect: () => onChange(option.value),
      }))}
      Trigger={SettingDropdownTrigger}
      triggerProps={{ label: active?.label ?? value, ariaLabel }}
    />
  );
}

function SettingDropdownTrigger({
  open,
  toggle,
  label,
  ariaLabel,
}: DropdownTriggerProps & { label: string; ariaLabel: string }): React.ReactElement {
  return (
    <button
      type="button"
      className="settings-action settings-dropdown-trigger"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={ariaLabel}
      title={ariaLabel}
      onClick={toggle}
    >
      <span>{label}</span>
      <span className="book-menu-arrow" aria-hidden="true">
        ▾
      </span>
    </button>
  );
}

function SettingCheckbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}): React.ReactElement {
  return (
    <label className="settings-item settings-item--checkbox">
      <div className="settings-item-text">
        <h2 className="settings-item-head">{label}</h2>
      </div>
      <input
        type="checkbox"
        className="settings-checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

export interface SettingsBook {
  groupId: string;
  profile: ClubProfile;
  onProfileChange: (profile: ClubProfile) => void;
}

type Category = "account" | "user" | "general" | "pdf";

// Account security is global and belongs on the homepage. Reader settings mix
// a club-specific profile with controls for the currently open book.
function categoriesFor(
  book: SettingsBook | undefined,
  signedIn: boolean,
): { id: Category; label: string }[] {
  if (book)
    return [
      { id: "user", label: "User" },
      { id: "general", label: "General" },
      { id: "pdf", label: "PDF" },
    ];
  return signedIn ? [{ id: "account", label: "Account" }] : [];
}

export function SettingsModal({
  book,
  signedIn = false,
  onClose,
}: {
  book?: SettingsBook;
  signedIn?: boolean;
  onClose: () => void;
}): React.ReactElement {
  const categories = categoriesFor(book, signedIn);
  const [category, setCategory] = useState<Category>(categories[0]?.id ?? "account");

  const { readingPositionOpenPolicy, smartArrows, pdfPageLayout } = useReaderPrefs();
  const { showAvatars } = useNotesPrefs();

  return (
    <Modal title={book ? "settings" : "account settings"} onClose={onClose}>
      <div className="modal-body settings-body">
        {category === "account" && <AccountSettings />}
        {category === "user" && book && (
          <UserSettings
            groupId={book.groupId}
            profile={book.profile}
            onChange={book.onProfileChange}
          />
        )}
        {category === "general" && book && (
          <>
            <section className="settings-item">
              <div className="settings-item-text">
                <h2 className="settings-item-head">Opening position</h2>
                <p className="settings-item-desc">
                  Whether to sync reading position across browsers
                </p>
              </div>
              <div className="settings-item-control">
                <SettingDropdown<ReadingPositionOpenPolicy>
                  value={readingPositionOpenPolicy}
                  onChange={(v) => setReaderPref("readingPositionOpenPolicy", v)}
                  ariaLabel="Opening reading position"
                  options={[
                    { value: "prefer-sync", label: "Sync" },
                    { value: "prefer-local", label: "Local" },
                  ]}
                />
              </div>
            </section>
            <SettingCheckbox
              label="Show profile pics"
              checked={showAvatars}
              onChange={(v) => setNotesPref("showAvatars", v)}
            />
          </>
        )}
        {category === "pdf" && (
          <>
            <section className="settings-item">
              <div className="settings-item-text">
                <h2 className="settings-item-head">Page layout</h2>
                <p className="settings-item-desc">
                  Show two pages side by side, book-style, when the screen is wide enough.
                </p>
              </div>
              <div className="settings-item-control">
                <SettingDropdown<PdfPageLayout>
                  value={pdfPageLayout}
                  onChange={(v) => setReaderPref("pdfPageLayout", v)}
                  ariaLabel="PDF page layout"
                  options={[
                    { value: "single", label: "Single page" },
                    { value: "auto", label: "Two pages" },
                  ]}
                />
              </div>
            </section>
            <section className="settings-item">
              <div className="settings-item-text">
                <h2 className="settings-item-head">Smart arrow keys</h2>
                <p className="settings-item-desc">Arrow keys try to scroll before turning page.</p>
              </div>
              <div className="settings-item-control">
                <SettingDropdown<SmartArrows>
                  value={smartArrows}
                  onChange={(v) => setReaderPref("smartArrows", v)}
                  ariaLabel="PDF smart arrow keys"
                  options={[
                    { value: "off", label: "Off" },
                    { value: "smooth", label: "Smooth" },
                    { value: "instant", label: "Instant" },
                  ]}
                />
              </div>
            </section>
          </>
        )}
      </div>
      {categories.length > 1 && (
        <ModalPagerTabs
          tabs={categories.map((c) => ({ ...c, title: `${c.label} settings` }))}
          active={category}
          onChange={setCategory}
          className="settings-tabs"
        />
      )}
    </Modal>
  );
}

import { useEffect, useRef, useState } from "react";
import type { ClubProfile } from "../../../shared/types/profiles.ts";
import { MAX_DISPLAY_NAME_LENGTH } from "../../../shared/types/profiles.ts";
import {
  avatarImagePath,
  avatarInitial,
  updateClubProfile,
  uploadAvatarImage,
} from "../../logic/groups/groupClient.ts";
import { spawnToast } from "../shared/toast/toastStore.ts";

export function UserSettings({
  groupId,
  profile,
  onChange,
}: {
  groupId: string;
  profile: ClubProfile;
  onChange: (profile: ClubProfile) => void;
}): React.ReactElement {
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [savingName, setSavingName] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => setDisplayName(profile.displayName), [profile.displayName]);
  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  async function saveDisplayName(): Promise<void> {
    const name = displayName.trim();
    if (!name || name === profile.displayName) return;
    setSavingName(true);
    const result = await updateClubProfile(groupId, name);
    setSavingName(false);
    if (!result.ok) {
      spawnToast("Name update failed", "Couldn't update your name for this club.", {
        type: "error",
      });
      return;
    }
    onChange(result.value);
    spawnToast("Name updated", `You'll appear as ${result.value.displayName} in this club.`, {
      type: "info",
    });
  }

  async function uploadAvatar(file: File): Promise<void> {
    const localUrl = URL.createObjectURL(file);
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return localUrl;
    });
    setUploadingAvatar(true);
    const result = await uploadAvatarImage(file);
    setUploadingAvatar(false);
    if (!result.ok) {
      setPreviewUrl(null);
      spawnToast("Photo upload failed", "Try a smaller image or a different file.", {
        type: "error",
      });
      return;
    }
    onChange({ ...profile, avatarImageId: result.value });
    setPreviewUrl(null);
    spawnToast("Photo updated", "Your profile picture is now visible in your clubs.", {
      type: "info",
    });
  }

  const avatarUrl =
    previewUrl ??
    (profile.avatarImageId ? avatarImagePath(profile.id, profile.avatarImageId) : null);

  return (
    <>
      <section className="settings-item settings-user-profile">
        <div className="settings-user-avatar" aria-label="Profile picture">
          {avatarUrl ? (
            <img src={avatarUrl} alt="" />
          ) : (
            <span>{avatarInitial(profile.displayName)}</span>
          )}
        </div>
        <div className="settings-item-text">
          <h2 className="settings-item-head">Profile picture</h2>
          <p className="settings-item-desc"></p>
        </div>
        <div className="settings-item-control">
          <input
            ref={fileRef}
            hidden
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void uploadAvatar(file);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            className="settings-action"
            disabled={uploadingAvatar || savingName}
            onClick={() => fileRef.current?.click()}
          >
            {uploadingAvatar ? "Uploading…" : "Choose photo"}
          </button>
        </div>
      </section>
      <section className="settings-item settings-item--stacked">
        <div className="settings-item-text">
          <h2 className="settings-item-head">Nickname</h2>
          <p className="settings-item-desc">Per-club name</p>
        </div>
        <form
          className="settings-text-submit-form"
          onSubmit={(event) => {
            event.preventDefault();
            void saveDisplayName();
          }}
        >
          <input
            value={displayName}
            maxLength={MAX_DISPLAY_NAME_LENGTH}
            aria-label="Display name"
            onChange={(event) => setDisplayName(event.target.value)}
          />
          <button
            type="submit"
            className="settings-action settings-text-submit-button"
            aria-label="Save display name"
            title="Save display name (Enter)"
            disabled={
              savingName ||
              uploadingAvatar ||
              !displayName.trim() ||
              displayName.trim() === profile.displayName
            }
          >
            <span aria-hidden="true">↵</span>
          </button>
        </form>
      </section>
    </>
  );
}

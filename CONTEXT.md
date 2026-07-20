# Bookclub Context

Bookclub lets people form groups around shared books, reading activity, and discussion. Product copy calls a group a "club"; internal domain language uses **Group**.

## Language

**Group**:
A named reading group with one roster and a collection of books and notes. User-facing copy calls it a club.
_Avoid in internals_: Club

**Group Control Plane**:
The authoritative identity and administration of a **Group**: its metadata, public URL, roster, invitations, roles, group-specific member names, and book catalog. Account indexes and live presence are projections of this state.
_Avoid_: Group lifecycle

**Group Data Plane**:
The book files, notes, images, reading activity, and backups governed by a **Group Control Plane**. Group deletion initiates durable cleanup of this state.
_Avoid_: Group resources

**Book Catalog**:
The ordered book identities, metadata, and ownership recorded by a **Group Control Plane**. Book file bytes belong to the **Group Data Plane**.
_Avoid_: Book storage

**Public Group ID**:
The short unique identifier used to resolve a public group URL. The global registry is authoritative for uniqueness; the resolved **Group Control Plane** is authoritative for whether the group exists.
_Avoid_: Group slug

**Account Profile**:
A person's global default display name and avatar. The account is authoritative for these values.
_Avoid_: Member profile

**Group Member Name**:
A member's group-specific display name. The **Group Control Plane** is authoritative; note authorship and presence receive projections of changes.
_Avoid_: Account display name

## Invariants

- Every Group Data Plane mutation is authorized against the current Group Control Plane role. Projected roles are display state, not authorization state.
- A committed control-plane change remains successful when a projection update fails; persisted desired state is reconciled until projections converge.
- Group deletion makes the Group immediately inaccessible and durably reconciles account indexes, public URL registration, and Group Data Plane cleanup afterward.
- Account avatar changes are eventually projected into groups. Previous avatar files remain available for a grace period so stale projections continue to resolve while reconciliation is pending.

## Example Dialogue

Developer: "The role change committed to the Group Control Plane, but the member's open note connection still has the old role."

Domain expert: "Keep the role change successful and reconcile the data-plane projection. The Group Control Plane remains authoritative."

Developer: "When the owner deletes the Group, should the request wait for every image to disappear?"

Domain expert: "No. Record deletion in the Group Control Plane, then durably clean up the Group Data Plane."

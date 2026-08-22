import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import { ClubProfile } from "../types/profiles.ts";
import { BookmarksResponse, SetBookmarkRequest } from "../types/bookmarks.ts";
import { ReadingPositionResponse, SetReadingPositionRequest } from "../types/readingPositions.ts";
import { SetUserPrefsRequest, UserPrefsResponse } from "../types/userPrefs.ts";
import { Created, StreamBytes } from "./compatibility.ts";
import { FileUpload, MAX_IMAGE_UPLOAD_BYTES } from "./uploads.ts";
import {
  BadRequestError,
  ForbiddenError,
  InternalErrorSchema,
  NotFoundError,
  TooLargeError,
  UnauthenticatedError,
} from "./errors.ts";

const Image = Schema.Struct({ id: Schema.String, contentType: Schema.String, size: Schema.Number });

export const AccountsHttp = HttpApiGroup.make("accounts").add(
  HttpApiEndpoint.get("prefs", "/me/prefs", {
    success: UserPrefsResponse,
    error: [UnauthenticatedError, InternalErrorSchema],
  }),
  HttpApiEndpoint.put("setPrefs", "/me/prefs", {
    payload: SetUserPrefsRequest,
    success: UserPrefsResponse,
    error: [BadRequestError, UnauthenticatedError, InternalErrorSchema],
  }),
  HttpApiEndpoint.get("readingPosition", "/me/reading-position", {
    query: { groupId: Schema.String, sourceId: Schema.String },
    success: ReadingPositionResponse,
    error: [
      BadRequestError,
      UnauthenticatedError,
      ForbiddenError,
      NotFoundError,
      InternalErrorSchema,
    ],
  }),
  HttpApiEndpoint.put("setReadingPosition", "/me/reading-position", {
    payload: SetReadingPositionRequest,
    success: ReadingPositionResponse,
    error: [
      BadRequestError,
      UnauthenticatedError,
      ForbiddenError,
      NotFoundError,
      InternalErrorSchema,
    ],
  }),
  HttpApiEndpoint.get("bookmarks", "/me/bookmarks", {
    query: { groupId: Schema.String, sourceId: Schema.String },
    success: BookmarksResponse,
    error: [UnauthenticatedError, ForbiddenError, NotFoundError, InternalErrorSchema],
  }),
  HttpApiEndpoint.put("setBookmark", "/me/bookmarks", {
    payload: SetBookmarkRequest,
    success: BookmarksResponse,
    error: [
      BadRequestError,
      UnauthenticatedError,
      ForbiddenError,
      NotFoundError,
      InternalErrorSchema,
    ],
  }),
  HttpApiEndpoint.put("uploadAvatar", "/me/avatar", {
    payload: FileUpload(MAX_IMAGE_UPLOAD_BYTES),
    success: Created(Image),
    error: [BadRequestError, UnauthenticatedError, TooLargeError, InternalErrorSchema],
  }),
  HttpApiEndpoint.put("setClubProfile", "/me/clubs/:groupRef/profile", {
    params: { groupRef: Schema.String },
    payload: Schema.Struct({ displayName: Schema.String }),
    success: Schema.Struct({ profile: ClubProfile }),
    error: [BadRequestError, UnauthenticatedError, ForbiddenError, InternalErrorSchema],
  }),
  HttpApiEndpoint.get("avatar", "/users/:userId/avatar/:imageId", {
    params: { userId: Schema.String, imageId: Schema.String },
    success: StreamBytes,
    error: [UnauthenticatedError, NotFoundError, InternalErrorSchema],
  }),
);

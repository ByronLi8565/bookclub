import { Effect } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http";
import { HttpApiClient } from "effect/unstable/httpapi";
import { BookclubHttp } from "../../../shared/http/BookclubHttp.ts";
import { apiOrigin, isNative, loadSessionToken } from "./api.ts";

const withNativeSession = (client: HttpClient.HttpClient): HttpClient.HttpClient =>
  HttpClient.mapRequestEffect(client, (request) =>
    Effect.promise(loadSessionToken).pipe(
      Effect.map((token) =>
        token === null
          ? request
          : HttpClientRequest.setHeader(request, "Authorization", `Bearer ${token}`),
      ),
    ),
  );

export const bookclubClient = HttpApiClient.make(BookclubHttp, {
  baseUrl: apiOrigin || undefined,
  transformClient: isNative ? withNativeSession : undefined,
}).pipe(Effect.provide(FetchHttpClient.layer));

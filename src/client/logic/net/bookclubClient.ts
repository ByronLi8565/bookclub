import { Effect } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http";
import { HttpApiClient } from "effect/unstable/httpapi";
import { BookclubHttp } from "../../../shared/http/BookclubHttp.ts";
import { apiOrigin, isNative, loadSessionToken, reportSessionExpiry } from "./api.ts";

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
  transformClient: (client) =>
    HttpClient.tap(isNative ? withNativeSession(client) : client, (response) =>
      Effect.sync(() => reportSessionExpiry(response.status, response.request.url)),
    ),
}).pipe(Effect.provide(FetchHttpClient.layer));

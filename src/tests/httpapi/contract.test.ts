import { describe, expect, it } from "vitest";
import { OpenApi } from "effect/unstable/httpapi";
import { BookclubHttp } from "../../shared/http/BookclubHttp.ts";

const expected = `
POST /auth/start 200,204
POST /auth/verify 200
POST /auth/signout 204
GET /auth/me 200
POST /auth/password 200
PUT /me/password 204
DELETE /me/password 204
POST /auth/passkey/register/options 200
POST /auth/passkey/register/verify 200
POST /auth/passkey/login/options 200
POST /auth/passkey/login/verify 200
GET /me/passkeys 200
DELETE /me/passkeys/:id 204
GET /me/prefs 200
PUT /me/prefs 200
GET /me/reading-position 200
PUT /me/reading-position 200
PUT /me/avatar 201
PUT /me/clubs/:groupRef/profile 200
GET /users/:userId/avatar/:imageId 200
GET /groups 200
POST /groups 201
GET /groups/:groupRef 200
POST /groups/:groupRef/invite-link 200
PUT /groups/:groupRef/title 200
PUT /groups/:groupRef/book/title 200
PUT /groups/:groupRef/book/parsed-title 200
POST /groups/:groupRef/invite 204
PUT /groups/:groupRef/members/:memberId/role 200
POST /groups/:groupRef/join 200
PUT /groups/:groupRef/book 200
GET /groups/:groupRef/book 200
DELETE /groups/:groupRef/book/:sourceId 200
PUT /groups/:groupRef/book/:sourceId/metadata 200
DELETE /groups/:groupRef 204
POST /groups/:groupRef/images 201
GET /groups/:groupRef/images 200
DELETE /groups/:groupRef/images/:imageId 204
GET /groups/:groupRef/images/:imageId 200
GET /groups/:groupRef/backup 200
PUT /groups/:groupRef/backup 200
POST /admin/backup 200
GET /admin/backups 200
POST /admin/prune 200
POST /admin/restore 200
`
  .trim()
  .split("\n");

const endpoints = Object.values(BookclubHttp.groups).flatMap((group) =>
  Object.values(group.endpoints),
);

const spec = OpenApi.fromApi(BookclubHttp);
const operations = Object.entries(spec.paths).flatMap(([path, methods]) =>
  Object.entries(methods).map(([method, operation]) => ({
    route: `${method.toUpperCase()} ${path.replaceAll(/\{([^}]+)\}/gu, ":$1")}`,
    responses: Object.keys(operation.responses),
  })),
);

describe("Bookclub HttpApi contract", () => {
  it("declares every legacy method, path, and success status", () => {
    expect(endpoints).toHaveLength(45);
    expect(
      operations
        .map(
          ({ route, responses }) =>
            `${route} ${responses.filter((status) => Number(status) < 400).join(",")}`,
        )
        .toSorted(),
    ).toEqual(expected.toSorted());
  });

  it("generates the same 45 operations in OpenAPI", () => {
    expect(operations.map(({ route }) => route).toSorted()).toEqual(
      expected.map((line) => line.split(" ").slice(0, 2).join(" ")).toSorted(),
    );
  });

  it("keeps every planned error status represented", () => {
    const statuses = new Set(
      operations.flatMap(({ responses }) =>
        responses.map(Number).filter((status) => status >= 400),
      ),
    );

    expect([...statuses].toSorted((a, b) => a - b)).toEqual([
      400, 401, 403, 404, 409, 413, 429, 500, 503,
    ]);
  });
});

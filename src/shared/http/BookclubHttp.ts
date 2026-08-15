import { HttpApi } from "effect/unstable/httpapi";
import { AccountsHttp } from "./accounts.ts";
import { AdminHttp } from "./admin.ts";
import { AuthHttp } from "./auth.ts";
import { GroupsHttp } from "./groups.ts";

export const BookclubHttp = HttpApi.make("bookclub")
  .add(AuthHttp)
  .add(AccountsHttp)
  .add(GroupsHttp)
  .add(AdminHttp);

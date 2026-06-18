import { Controller, Get } from "@nestjs/common";
import type { Menu, Tenant } from "@amber/domain";
import { MenuService } from "./menu.service.js";
import { CurrentTenant } from "../tenant/current-tenant.decorator.js";

@Controller("menu")
export class MenuController {
  constructor(private readonly menu: MenuService) {}

  @Get()
  get(@CurrentTenant() tenant: Tenant): Promise<Menu> {
    return this.menu.getMenu(tenant.id);
  }
}

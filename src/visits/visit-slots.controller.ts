import { Controller, Get, Query } from "@nestjs/common";

import { ListVisitSlotsQueryDto } from "./dto/list-visit-slots.query.js";
import { VisitSlotsService, type PublicVisitSlot } from "./visit-slots.service.js";

/** Pełna ścieżka: GET /api/visit-slots?from=YYYY-MM-DD&to=YYYY-MM-DD */
@Controller("visit-slots")
export class VisitSlotsController {
  constructor(private readonly visitSlotsService: VisitSlotsService) {}

  @Get()
  list(@Query() query: ListVisitSlotsQueryDto): Promise<PublicVisitSlot[]> {
    return this.visitSlotsService.findInRange(query.from, query.to);
  }
}

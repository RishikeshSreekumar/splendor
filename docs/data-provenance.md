# Rules and factual data

The engine implements the base game, not Splendor Duel or expansions. No artwork, card illustrations, or source code from other game implementations is included.

## Rules authority

- [Publisher's game page](https://www.spacecowboys-games.com/game/splendor/).
- [Current English base-game rules](https://cdn.svc.asmodee.net/production-spacecowboys/uploads/2025/10/SCSPL01EN_SPLENDOR_RULES_LIGHT.pdf), consulted 2026-10-02. This edition explicitly allows gold in place of a held colored piece, describes the reduced token take when fewer colors remain, and clarifies shared victories after the purchased-card tiebreak.
- [Publisher-verified Dized FAQ](https://rules.dized.com/game/vdDSzuu4RsC8F45PsW0TKw/faq), consulted 2026-10-02.

## Card costs

`data/cards.json` contains only identifiers and numerical gameplay properties. All 90 rows were normalized and compared as a multiset against both independent CSV transcriptions:

- [bouk/splendimax, commit 5ffcb148](https://github.com/bouk/splendimax/blob/5ffcb148ee0093e3b47f612b04a1927301ff13ee/Splendor%20Cards.csv).
- [seal256/splendor, commit 263abc06](https://github.com/seal256/splendor/blob/263abc066c563a1c89dba4bdc408446a20ad9d1d/assets/cards.csv).

They agree on all 90 tuples of tier, bonus, points, and five costs. Local card IDs follow the first CSV's row order. `scripts/verify-data.ts` repeats the comparison without importing or executing remote code. Agreement between transcriptions is evidence, not an independent audit against every physical card. Physical-deck review remains a release gate.

## Nobles

The ten requirement vectors match the [NOBLES constant in seal256/splendor](https://github.com/seal256/splendor/blob/263abc066c563a1c89dba4bdc408446a20ad9d1d/pysplendor/splendor.py#L125):

| Requirement              | Copies |
| ------------------------ | ------ |
| Red 4, green 4           | 1      |
| Green 4, blue 4          | 1      |
| Blue 4, white 4          | 1      |
| White 4, black 4         | 1      |
| Black 4, red 4           | 1      |
| Red 3, green 3, blue 3   | 1      |
| Green 3, blue 3, white 3 | 1      |
| Blue 3, white 3, black 3 | 1      |
| White 3, black 3, red 3  | 1      |
| Black 3, red 3, green 3  | 1      |

Each awards three points. We generate these adjacent pairs and triples from the fixed red/green/blue/white/black cycle. A separate reference's noble list was incomplete, and another had an inconsistent triple; neither was accepted as the source of truth. Noble names are not required for gameplay and are omitted.

Splendor belongs to its respective rights holders. This project is an unofficial implementation and makes no claim of publisher endorsement.

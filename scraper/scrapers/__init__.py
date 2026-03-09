"""Dog food scraper registry."""

from .royalcanin import scrape_royalcanin
from .purina import scrape_purina
from .hills import scrape_hills
from .rayne import scrape_rayne
from .gosolutions import scrape_gosolutions
from .nowfresh import scrape_nowfresh
from .tasteofthewild import scrape_tasteofthewild
from .firstmate import scrape_firstmate
from .canadiannaturals import scrape_canadiannaturals
from .nutrience import scrape_nutrience
from .openfarm import scrape_openfarm
from .bluebuffalo import scrape_bluebuffalo
from .iams import scrape_iams
from .acana import scrape_acana
from .performatrin import scrape_performatrin
from .authority import scrape_authority
from .pedigree import scrape_pedigree
from .nutro import scrape_nutro
from .wellness import scrape_wellness
from .stellachewys import scrape_stellachewys
from .merrick import scrape_merrick
from .farmina import scrape_farmina

# Registry: key -> (display_name, scrape_function)
# Each function: (output_dir: Path) -> int (product count)
SCRAPERS: dict[str, tuple[str, callable]] = {
    # Phase 1a — Big 3 (verified, ~500 products)
    "royalcanin": ("Royal Canin", scrape_royalcanin),
    "purina": ("Purina", scrape_purina),
    "hills": ("Hill's", scrape_hills),
    # Phase 1b — Group A: HTML parse (confirmed data)
    "rayne": ("Rayne", scrape_rayne),
    "gosolutions": ("Go! Solutions", scrape_gosolutions),
    "nowfresh": ("Now Fresh", scrape_nowfresh),
    "tasteofthewild": ("Taste of the Wild", scrape_tasteofthewild),
    "firstmate": ("FirstMate", scrape_firstmate),
    "canadiannaturals": ("Canadian Naturals", scrape_canadiannaturals),
    "nutrience": ("Nutrience", scrape_nutrience),
    # Phase 1b — Group B: Shopify + page scrape
    "openfarm": ("Open Farm", scrape_openfarm),
    # Phase 1b — Group C/D: Investigation needed
    "bluebuffalo": ("Blue Buffalo", scrape_bluebuffalo),
    "iams": ("Iams", scrape_iams),
    "acana": ("Acana/Orijen", scrape_acana),
    "performatrin": ("Performatrin", scrape_performatrin),
    "authority": ("Authority", scrape_authority),
    "pedigree": ("Pedigree", scrape_pedigree),
    "nutro": ("Nutro", scrape_nutro),
    "wellness": ("Wellness", scrape_wellness),
    "stellachewys": ("Stella & Chewy's", scrape_stellachewys),
    "merrick": ("Merrick", scrape_merrick),
    "farmina": ("Farmina", scrape_farmina),
}

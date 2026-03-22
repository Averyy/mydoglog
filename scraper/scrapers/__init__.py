"""Dog food scraper registry."""

from .royalcanin import scrape_royalcanin
from .purina_vet import scrape_purina_vet
from .purina_retail import scrape_purina_retail
from .hills_retail import scrape_hills_retail
from .hills_vet import scrape_hills_vet
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
from .simplynourish import scrape_simplynourish
from .naturalbalance import scrape_naturalbalance
from .instinct import scrape_instinct
from .nulo import scrape_nulo
from .canidae import scrape_canidae
from .eukanuba import scrape_eukanuba
from .kirkland import scrape_kirkland
from .nutrish import scrape_nutrish
from .fromm import scrape_fromm

# Registry: key -> (display_name, scrape_function)
# Each function: (output_dir: Path) -> int (product count)
SCRAPERS: dict[str, tuple[str, callable]] = {
    # Phase 1a — Big 3 (verified, ~500 products)
    "royalcanin": ("Royal Canin", scrape_royalcanin),
    "purina_vet": ("Purina (Vet)", scrape_purina_vet),
    "purina_retail": ("Purina (Retail)", scrape_purina_retail),
    "hills_retail": ("Hill's (Retail)", scrape_hills_retail),
    "hills_vet": ("Hill's (Vet)", scrape_hills_vet),
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
    # Phase 2 — New sources
    "simplynourish": ("Simply Nourish", scrape_simplynourish),
    "naturalbalance": ("Natural Balance", scrape_naturalbalance),
    "instinct": ("Instinct", scrape_instinct),
    "nulo": ("Nulo", scrape_nulo),
    "canidae": ("Canidae", scrape_canidae),
    "eukanuba": ("Eukanuba", scrape_eukanuba),
    "kirkland": ("Kirkland Signature", scrape_kirkland),
    "nutrish": ("Rachael Ray Nutrish", scrape_nutrish),
    "fromm": ("Fromm", scrape_fromm),
}

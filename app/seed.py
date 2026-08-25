"""Seed the SQLite database from menu.json + image folder mapping.

Run: python -m app.seed
Idempotent — safe to run multiple times, but will not overwrite user edits.
"""
from __future__ import annotations

import json
from pathlib import Path

from app.db import ensure_default_settings, get_conn, init_db

MENU_JSON = Path(__file__).resolve().parent.parent / "data" / "menu.json"

# Map Arabic item names to image slug (from static/images/food)
IMAGE_MAP = {
    "بيتزا مكس الأجبان": "mix-cheese-pizza.png",
    "بيتزا الثوم والجبنة": "garlic-cheese-pizza.png",
    "بيتزا مرجريتا": "margarita-pizza.png",
    "بيتزا مدترينيا": "mediterranee-pizza.png",
    "بيتزا جبنة بيضاء": "white-cheese-pizza.png",
    "بيتزا روست بيف": "roast-beef-pizza.png",
    "بيتزا روست بيف مع خضار": "roast-beef-vegetables-pizza.png",
    "بيتزا سلامي": "salami-pizza.png",
    "بيتزا سلامي مع خضار": "salami-vegetables-pizza.png",
    "بيتزا بيبروني": "pepperoni-pizza.png",
    "بيتزا بيبروني مع خضار": "pepperoni-vegetables-pizza.png",
    "بيتزا سلامي مكس": "mix-salami-pizza.png",
    "مكس بيتزا": "mix-pizza.png",
    "أجنحة دجاج": "chicken-wings.png",
    "أصابع دجاج": "chicken-fingers.png",
    "أصابع جبنة": "cheese-sticks.png",
    "سلطة سيزر مع دجاج": "caesar-salad-with-chicken.png",
    "سلطة يونانية": "greek-salad.png",
    "ستيك فيلادلفيا بالجبنة": "philadelphia-cheese-steak.png",
    "برغر لحمة": "beef-burger.png",
    "كولا بأنواعها": "all-kinds-of-cola.png",
    "عصائر مشكلة": "fresh-mixed-juice.png",
    "مياه معدنية": "mineral-water.png",
}

CATEGORY_ICONS = {
    "بيتزا الأجبان": "🧀",
    "بيتزا اللحوم والخضار": "🍖",
    "مقبلات وسلطات": "🥗",
    "ساندويشات": "🥪",
    "مشروبات باردة": "🥤",
}

# Additional items (from images that are not in the original menu). Prices are
# estimated placeholders — the restaurant owner should adjust from admin panel.
EXTRA_ITEMS: list[dict] = [
    # Extra cheese pizzas
    {
        "category": "بيتزا الأجبان",
        "name": "بيتزا ألفريدو",
        "name_en": "Alfredo Pizza",
        "description": "صلصة ألفريدو الكريمية، جبنة موزاريلا، جبنة صفراء",
        "image": "alfredo-pizza.png",
        "sizes": [{"name": "S", "price": 32}, {"name": "M", "price": 55}, {"name": "L", "price": 65}, {"name": "XL", "price": 78}],
        "vegetarian": 1,
    },
    {
        "category": "بيتزا الأجبان",
        "name": "بيتزا فور سيزون",
        "name_en": "Four Seasons Pizza",
        "description": "أربعة أقسام: خضار، لحم، دجاج، فطر",
        "image": "four-seasons-pizza.png",
        "sizes": [{"name": "S", "price": 38}, {"name": "M", "price": 65}, {"name": "L", "price": 78}, {"name": "XL", "price": 90}],
    },
    {
        "category": "بيتزا الأجبان",
        "name": "بيتزا الأناناس (هاواي)",
        "name_en": "Pineapple Pizza",
        "description": "صلصة، جبنة موزاريلا، أناناس، قطع دجاج",
        "image": "pineapple-pizza.png",
        "sizes": [{"name": "S", "price": 32}, {"name": "M", "price": 55}, {"name": "L", "price": 65}, {"name": "XL", "price": 78}],
    },
    # Meat & extras
    {
        "category": "بيتزا اللحوم والخضار",
        "name": "بيتزا الباربيكيو",
        "name_en": "Barbeque Pizza",
        "description": "صلصة الباربيكيو، دجاج مشوي، بصل، جبنة موزاريلا",
        "image": "barbeque-pizza.png",
        "sizes": [{"name": "S", "price": 35}, {"name": "M", "price": 60}, {"name": "L", "price": 72}, {"name": "XL", "price": 85}],
    },
    {
        "category": "بيتزا اللحوم والخضار",
        "name": "بيتزا باربيكيو مع خضار",
        "name_en": "Barbeque & Vegetables Pizza",
        "description": "صلصة باربيكيو، دجاج، فلفل، بصل، ذرة، ماشروم",
        "image": "barbeque-pizza-vegetables.png",
        "sizes": [{"name": "S", "price": 38}, {"name": "M", "price": 65}, {"name": "L", "price": 78}, {"name": "XL", "price": 90}],
    },
    {
        "category": "بيتزا اللحوم والخضار",
        "name": "بيتزا مكسيكية حارة",
        "name_en": "Hot Mexican Pizza",
        "description": "لحم مفروم، فلفل حار، بصل، فاصولياء",
        "image": "hot-mexican-pizza.png",
        "sizes": [{"name": "S", "price": 35}, {"name": "M", "price": 62}, {"name": "L", "price": 72}, {"name": "XL", "price": 85}],
        "spicy": 1,
    },
    {
        "category": "بيتزا اللحوم والخضار",
        "name": "بيتزا هالبينو",
        "name_en": "Jalapeno Pizza",
        "description": "فلفل هالبينو، جبنة موزاريلا، صلصة",
        "image": "jalapeno-pizza.png",
        "sizes": [{"name": "S", "price": 32}, {"name": "M", "price": 58}, {"name": "L", "price": 68}, {"name": "XL", "price": 80}],
        "spicy": 1,
        "vegetarian": 1,
    },
    {
        "category": "بيتزا اللحوم والخضار",
        "name": "بيتزا سجق",
        "name_en": "Sausage Pizza",
        "description": "صلصة البيتزا، شرائح سجق، جبنة موزاريلا",
        "image": "sausage-pizza.png",
        "sizes": [{"name": "S", "price": 32}, {"name": "M", "price": 58}, {"name": "L", "price": 68}, {"name": "XL", "price": 80}],
    },
    {
        "category": "بيتزا اللحوم والخضار",
        "name": "بيتزا سجق مع خضار",
        "name_en": "Sausage & Vegetables Pizza",
        "description": "سجق، فلفل، بصل، زيتون، ذرة",
        "image": "sausage-vegetables-pizza.png",
        "sizes": [{"name": "S", "price": 35}, {"name": "M", "price": 62}, {"name": "L", "price": 72}, {"name": "XL", "price": 85}],
    },
    {
        "category": "بيتزا اللحوم والخضار",
        "name": "بيتزا هوت دوغ",
        "name_en": "Hot Dog Pizza",
        "description": "قطع هوت دوغ، صلصة، جبنة",
        "image": "hot-dog-pizza.png",
        "sizes": [{"name": "S", "price": 30}, {"name": "M", "price": 55}, {"name": "L", "price": 65}, {"name": "XL", "price": 75}],
    },
    {
        "category": "بيتزا اللحوم والخضار",
        "name": "بيتزا لحم مع خضار",
        "name_en": "Meat & Vegetable Pizza",
        "description": "لحم مفروم، فلفل، بصل، طماطم",
        "image": "meat-vegetable-pizza.png",
        "sizes": [{"name": "S", "price": 35}, {"name": "M", "price": 62}, {"name": "L", "price": 72}, {"name": "XL", "price": 85}],
    },
    {
        "category": "بيتزا اللحوم والخضار",
        "name": "بيتزا خضار",
        "name_en": "Vegetable Pizza",
        "description": "فلفل، زيتون، ذرة، ماشروم، بصل، طماطم",
        "image": "vegetable-pizza.png",
        "sizes": [{"name": "S", "price": 28}, {"name": "M", "price": 48}, {"name": "L", "price": 58}, {"name": "XL", "price": 72}],
        "vegetarian": 1,
    },
    {
        "category": "بيتزا اللحوم والخضار",
        "name": "بيتزا باذنجان",
        "name_en": "Eggplant Pizza",
        "description": "باذنجان مشوي، صلصة، جبنة",
        "image": "eggplant-pizza.png",
        "sizes": [{"name": "S", "price": 28}, {"name": "M", "price": 48}, {"name": "L", "price": 58}, {"name": "XL", "price": 72}],
        "vegetarian": 1,
    },
    {
        "category": "بيتزا اللحوم والخضار",
        "name": "بيتزا تونة",
        "name_en": "Tuna Pizza",
        "description": "تونة، بصل، زيتون، جبنة",
        "image": "tuna-pizza.png",
        "sizes": [{"name": "S", "price": 32}, {"name": "M", "price": 58}, {"name": "L", "price": 68}, {"name": "XL", "price": 80}],
    },
    {
        "category": "بيتزا اللحوم والخضار",
        "name": "بيتزا مأكولات بحرية",
        "name_en": "Seafood Pizza",
        "description": "روبيان، تونة، صلصة، جبنة",
        "image": "seafruit-pizza.png",
        "sizes": [{"name": "S", "price": 40}, {"name": "M", "price": 68}, {"name": "L", "price": 80}, {"name": "XL", "price": 95}],
    },
    {
        "category": "بيتزا اللحوم والخضار",
        "name": "بيتزا روبيان",
        "name_en": "Shrimps Pizza",
        "description": "روبيان مشوي، ثوم، جبنة",
        "image": "shrimps-pizza.png",
        "sizes": [{"name": "S", "price": 42}, {"name": "M", "price": 72}, {"name": "L", "price": 85}, {"name": "XL", "price": 100}],
    },
    # Sandwiches
    {
        "category": "ساندويشات",
        "name": "برغر دجاج",
        "name_en": "Chicken Burger",
        "description": "قطعة دجاج، خس، بندورة، مايونيز",
        "image": "chicken-burger.png",
        "price": 22,
    },
    {
        "category": "ساندويشات",
        "name": "دبل برغر لحم",
        "name_en": "Double Beef Burger",
        "description": "قطعتين لحم، جبنة، خضار",
        "image": "double-beef-burger.png",
        "price": 35,
    },
    {
        "category": "ساندويشات",
        "name": "دبل برغر دجاج",
        "name_en": "Double Chicken Burger",
        "description": "قطعتين دجاج، جبنة، خضار",
        "image": "double-chicken-burger.png",
        "price": 32,
    },
    {
        "category": "ساندويشات",
        "name": "ساندويش دجاج مقرمش",
        "name_en": "Crispy Chicken Sandwich",
        "description": "دجاج مقرمش، خس، مايونيز",
        "image": "crispy-chicken-sandwich.png",
        "price": 25,
    },
    {
        "category": "ساندويشات",
        "name": "ساندويش دجاج بدون عظم",
        "name_en": "Boneless Chicken Sandwich",
        "description": "قطع دجاج، خضار، صوص",
        "image": "boneless-chicken-sandwich.png",
        "price": 24,
    },
    {
        "category": "ساندويشات",
        "name": "ساندويش روست بيف",
        "name_en": "Roast Beef Sandwich",
        "description": "شرائح روست بيف، خضار، صوص",
        "image": "roast-beef-sandwich.png",
        "price": 30,
    },
    {
        "category": "ساندويشات",
        "name": "ساندويش سلامي مكس",
        "name_en": "Salami Mix Sandwich",
        "description": "سلامي، بيبروني، جبنة، خضار",
        "image": "salami-mix-sandwich.png",
        "price": 28,
    },
    {
        "category": "ساندويشات",
        "name": "ساندويش سجق",
        "name_en": "Sausage Sandwich",
        "description": "سجق، خضار، صوص",
        "image": "sausage-sandwich.png",
        "price": 22,
    },
    {
        "category": "ساندويشات",
        "name": "ساندويش هوت دوغ",
        "name_en": "Hot Dog Sandwich",
        "description": "هوت دوغ، خردل، كاتشب",
        "image": "hot-dog-sandwich.png",
        "price": 18,
    },
    {
        "category": "ساندويشات",
        "name": "ساندويش باربيكيو",
        "name_en": "Barbeque Sandwich",
        "description": "دجاج بصلصة الباربيكيو، خضار",
        "image": "barbeque-sandwich.png",
        "price": 26,
    },
    {
        "category": "ساندويشات",
        "name": "ساندويش مكسيكي",
        "name_en": "Mexican Sandwich",
        "description": "لحم، فلفل حار، جبنة",
        "image": "mexican-sandwich.png",
        "price": 28,
        "spicy": 1,
    },
    # Appetizers & sides
    {
        "category": "مقبلات وسلطات",
        "name": "بطاطا فرنسية",
        "name_en": "French Fries",
        "description": "بطاطا مقلية مقرمشة",
        "image": "french-fries.png",
        "price": 10,
        "vegetarian": 1,
    },
    {
        "category": "مقبلات وسلطات",
        "name": "بطاطا ويدجز",
        "name_en": "Potato Wedges",
        "description": "بطاطا مقلية بالتوابل",
        "image": "potato-wedges.png",
        "price": 14,
        "vegetarian": 1,
    },
    {
        "category": "مقبلات وسلطات",
        "name": "بطاطا كيرلي",
        "name_en": "Curly Potatoes",
        "description": "بطاطا حلزونية مقلية",
        "image": "curly-potatoes.png",
        "price": 14,
        "vegetarian": 1,
    },
    {
        "category": "مقبلات وسلطات",
        "name": "كرات البطاطا",
        "name_en": "Potato Balls",
        "description": "كرات بطاطا محشية بالجبنة",
        "image": "potato-balls.png",
        "price": 16,
        "vegetarian": 1,
    },
    {
        "category": "مقبلات وسلطات",
        "name": "حلقات بصل",
        "name_en": "Onion Rings",
        "description": "حلقات بصل مقرمشة",
        "image": "onion-rings.png",
        "price": 14,
        "vegetarian": 1,
    },
    {
        "category": "مقبلات وسلطات",
        "name": "خبز بالثوم",
        "name_en": "Garlic Bread",
        "description": "خبز طازج بالثوم والزبدة",
        "image": "garlic-bread.png",
        "price": 12,
        "vegetarian": 1,
    },
    {
        "category": "مقبلات وسلطات",
        "name": "خبز بالثوم والجبنة",
        "name_en": "Cheesy Garlic Bread",
        "description": "خبز بالثوم مع جبنة موزاريلا مذابة",
        "image": "cheesy-garlic-bread.png",
        "price": 16,
        "vegetarian": 1,
    },
    {
        "category": "مقبلات وسلطات",
        "name": "سلطة سيزر",
        "name_en": "Caesar Salad",
        "description": "خس، جبنة بارميزان، كروتون، صلصة سيزر",
        "image": "caesar-salad.png",
        "price": 22,
        "vegetarian": 1,
    },
    {
        "category": "مقبلات وسلطات",
        "name": "سلطة خضراء",
        "name_en": "Green Salad",
        "description": "خس، خيار، فلفل، طماطم",
        "image": "green-salad.png",
        "price": 18,
        "vegetarian": 1,
    },
    {
        "category": "مقبلات وسلطات",
        "name": "سلطة جرجير",
        "name_en": "Arugula Salad",
        "description": "جرجير، بندورة كرزية، بارميزان، ليمون",
        "image": "arugula-salad.png",
        "price": 20,
        "vegetarian": 1,
    },
    {
        "category": "مقبلات وسلطات",
        "name": "فتوش",
        "name_en": "Fatoosh",
        "description": "خضار طازجة، خبز محمص، سماق، دبس رمان",
        "image": "fatoosh.png",
        "price": 20,
        "vegetarian": 1,
    },
    {
        "category": "مقبلات وسلطات",
        "name": "تبولة",
        "name_en": "Tabouleh",
        "description": "بقدونس، برغل، بندورة، ليمون",
        "image": "tabouleh.png",
        "price": 20,
        "vegetarian": 1,
    },
    # Pasta section
    {
        "category": "معكرونة",
        "name": "فيتوتشيني ألفريدو",
        "name_en": "Fettuccine Alfredo",
        "description": "معكرونة فيتوتشيني بصلصة الكريمة",
        "image": "fettuccine.png",
        "price": 30,
        "vegetarian": 1,
    },
    {
        "category": "معكرونة",
        "name": "فيتوتشيني بالدجاج",
        "name_en": "Fettuccine with Chicken",
        "description": "فيتوتشيني مع قطع دجاج بصلصة الكريمة",
        "image": "fettuccine-with-chicken.png",
        "price": 38,
    },
    {
        "category": "معكرونة",
        "name": "لازانيا لحمة",
        "name_en": "Meat Lasagna",
        "description": "لازانيا بلحم مفروم وصلصة طماطم وبشاميل",
        "image": "meat-lasagna.png",
        "price": 40,
    },
    {
        "category": "معكرونة",
        "name": "لازانيا خضار",
        "name_en": "Vegetables Lasagna",
        "description": "لازانيا خضار مع صلصة بشاميل",
        "image": "vegetables-lasagna.png",
        "price": 35,
        "vegetarian": 1,
    },
    # Drinks
    {
        "category": "مشروبات باردة",
        "name": "مياه غازية",
        "name_en": "Soda Water",
        "description": "علبة 330 مل",
        "image": "soda-water.png",
        "price": 4,
    },
]


def _load_seed_menu() -> dict:
    with open(MENU_JSON, encoding="utf-8") as f:
        return json.load(f)


def seed_all(*, force: bool = False) -> None:
    init_db()
    ensure_default_settings()
    conn = get_conn()

    existing = conn.execute("SELECT COUNT(*) as c FROM items").fetchone()["c"]
    if existing and not force:
        print(f"items already seeded ({existing}). Use force=True to reseed.")
        return

    if force:
        conn.execute("DELETE FROM items")
        conn.execute("DELETE FROM categories")

    menu = _load_seed_menu()
    r = menu["restaurant"]

    # Apply restaurant info to settings (only if empty)
    from app.db import get_setting, set_setting
    if not get_setting("restaurant_name"):
        set_setting("restaurant_name", r.get("name", "بيتزا باربيكيو"))
    if not get_setting("restaurant_name_en"):
        set_setting("restaurant_name_en", r.get("name_en", "Barbeque Pizza"))

    # Build categories from JSON + extras
    category_names: list[str] = []
    for cat in menu["categories"]:
        if cat["name"] not in category_names:
            category_names.append(cat["name"])
    for extra in EXTRA_ITEMS:
        if extra["category"] not in category_names:
            category_names.append(extra["category"])

    cat_id_by_name: dict[str, int] = {}
    for order, name in enumerate(category_names):
        icon = CATEGORY_ICONS.get(name, "🍽️")
        cur = conn.execute(
            "INSERT INTO categories(name, icon, sort_order) VALUES(?,?,?)",
            (name, icon, order),
        )
        cat_id_by_name[name] = cur.lastrowid or 0

    # Insert items from original menu
    order_counter: dict[int, int] = {}
    for cat in menu["categories"]:
        cid = cat_id_by_name[cat["name"]]
        for item in cat["items"]:
            image = IMAGE_MAP.get(item["name"])
            sizes = item.get("sizes")
            price = item.get("price")
            order_counter[cid] = order_counter.get(cid, 0) + 1
            conn.execute(
                "INSERT INTO items(category_id,name,name_en,description,image,"
                "sizes_json,price,vegetarian,spicy,available,sort_order) "
                "VALUES(?,?,?,?,?,?,?,?,?,1,?)",
                (
                    cid,
                    item["name"],
                    item.get("name_en"),
                    item.get("description"),
                    image,
                    json.dumps(sizes, ensure_ascii=False) if sizes else None,
                    price,
                    1 if item.get("vegetarian") else 0,
                    1 if item.get("spicy") else 0,
                    order_counter[cid],
                ),
            )

    # Insert EXTRA_ITEMS
    for extra in EXTRA_ITEMS:
        cid = cat_id_by_name[extra["category"]]
        order_counter[cid] = order_counter.get(cid, 0) + 1
        conn.execute(
            "INSERT INTO items(category_id,name,name_en,description,image,"
            "sizes_json,price,vegetarian,spicy,available,sort_order) "
            "VALUES(?,?,?,?,?,?,?,?,?,1,?)",
            (
                cid,
                extra["name"],
                extra.get("name_en"),
                extra.get("description"),
                extra.get("image"),
                json.dumps(extra.get("sizes"), ensure_ascii=False) if extra.get("sizes") else None,
                extra.get("price"),
                extra.get("vegetarian", 0),
                extra.get("spicy", 0),
                order_counter[cid],
            ),
        )

    conn.commit()

    count = conn.execute("SELECT COUNT(*) as c FROM items").fetchone()["c"]
    print(f"seeded {count} items across {len(cat_id_by_name)} categories")


if __name__ == "__main__":
    import sys
    seed_all(force="--force" in sys.argv)

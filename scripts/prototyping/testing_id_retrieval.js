import axios from "axios";

// Test ship type IDs (mix of capitals and non-capitals)
const testShipIds = [
  23911, // Carrier
  672, // Battleship
  37604, // FAX
  626, // Cruiser
  19720, // Dreadnought
];

async function getShipCategory(typeId) {
  try {
    const response = await axios.get(
      `https://esi.evetech.net/latest/universe/types/${typeId}/`
    );
    console.log(response);
    return {
      typeId: typeId,
      name: response.data.name,
      groupId: response.data.group_id,
      categoryId: response.data.category_id,
    };
  } catch (error) {
    console.error(
      `Error fetching data for ship type ${typeId}:`,
      error.message
    );
    return null;
  }
}

async function testShipCategories() {
  console.log("Starting ship category test...\n");

  for (const shipId of testShipIds) {
    try {
      const shipData = await getShipCategory(shipId);
      if (shipData) {
        console.log(`Ship ID: ${shipData.typeId}`);
        console.log(`Name: ${shipData.name}`);
        console.log(`Group ID: ${shipData.groupId}`);
        console.log(`Category ID: ${shipData.categoryId}`);
        console.log("-------------------");
      }
    } catch (error) {
      console.error(`Failed to process ship ID ${shipId}:`, error.message);
    }
  }
}

// Run the test
testShipCategories();

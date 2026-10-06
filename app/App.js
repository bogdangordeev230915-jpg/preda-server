import React, { useState } from "react";

import {
  SafeAreaView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Modal,
  StatusBar,
  Alert
} from "react-native";

const BROWN = "#6B3F25";
const DARK_BROWN = "#4A2918";
const LIGHT_BROWN = "#F3E8DF";
const CREAM = "#FFFDFB";

const API_URL = "https://YOUR-RENDER-URL.onrender.com";

export default function App() {
  const [activeTab, setActiveTab] = useState("chats");

  const [searchVisible, setSearchVisible] = useState(false);
  const [searchCode, setSearchCode] = useState("");
  const [searching, setSearching] = useState(false);
  const [foundUser, setFoundUser] = useState(null);

  const [selectedChat, setSelectedChat] = useState(null);

  const [chats] = useState([
    {
      id: "1",
      type: "direct",
      title: "Иван",
      preview: "Привет!",
      time: "12:42",
      avatar: "И"
    },
    {
      id: "2",
      type: "group",
      title: "Наша компания",
      preview: "Алексей: Всем привет",
      time: "11:30",
      avatar: "👥"
    },
    {
      id: "3",
      type: "channel",
      title: "Новости PrēDa",
      preview: "Новая публикация",
      time: "10:15",
      avatar: "📢"
    }
  ]);

  async function searchUser() {
    if (!searchCode.trim()) {
      return;
    }

    setSearching(true);
    setFoundUser(null);

    try {
      const response = await fetch(
        `${API_URL}/api/users/by-code/${encodeURIComponent(
          searchCode.trim()
        )}`,
        {
          headers: {
            Authorization: "Bearer YOUR_TOKEN"
          }
        }
      );

      const data = await response.json();

      if (!response.ok) {
        Alert.alert(
          "PrēDa",
          data.error || "Пользователь не найден"
        );
        return;
      }

      setFoundUser(data);
    } catch (error) {
      Alert.alert(
        "Ошибка",
        "Не удалось подключиться к серверу"
      );
    } finally {
      setSearching(false);
    }
  }

  function openChat(chat) {
    setSelectedChat(chat);
  }

  function closeChat() {
    setSelectedChat(null);
  }

  function renderChat({ item }) {
    return (
      <TouchableOpacity
        style={styles.chatRow}
        onPress={() => openChat(item)}
        activeOpacity={0.7}
      >
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {item.avatar}
          </Text>
        </View>

        <View style={styles.chatInfo}>
          <View style={styles.chatTop}>
            <Text style={styles.chatTitle}>
              {item.title}
            </Text>

            <Text style={styles.chatTime}>
              {item.time}
            </Text>
          </View>

          <Text
            style={styles.chatPreview}
            numberOfLines={1}
          >
            {item.preview}
          </Text>
        </View>
      </TouchableOpacity>
    );
  }

  function filteredChats() {
    if (activeTab === "chats") {
      return chats.filter(
        item => item.type === "direct"
      );
    }

    if (activeTab === "groups") {
      return chats.filter(
        item => item.type === "group"
      );
    }

    return chats.filter(
      item => item.type === "channel"
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar
        barStyle="light-content"
        backgroundColor={BROWN}
      />

      <View style={styles.container}>

        {/* HEADER */}

        <View style={styles.header}>
          <Text style={styles.logo}>
            PrēDa
          </Text>

          <TouchableOpacity
            style={styles.searchButton}
            onPress={() => {
              setSearchVisible(true);
              setFoundUser(null);
              setSearchCode("");
            }}
          >
            <Text style={styles.searchIcon}>
              🔎
            </Text>
          </TouchableOpacity>
        </View>

        {/* TABS */}

        <View style={styles.tabs}>

          <TouchableOpacity
            style={[
              styles.tab,
              activeTab === "chats" &&
                styles.activeTab
            ]}
            onPress={() => setActiveTab("chats")}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === "chats" &&
                  styles.activeTabText
              ]}
            >
              Чаты
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.tab,
              activeTab === "groups" &&
                styles.activeTab
            ]}
            onPress={() => setActiveTab("groups")}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === "groups" &&
                  styles.activeTabText
              ]}
            >
              Группы
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.tab,
              activeTab === "channels" &&
                styles.activeTab
            ]}
            onPress={() => setActiveTab("channels")}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === "channels" &&
                  styles.activeTabText
              ]}
            >
              Каналы
            </Text>
          </TouchableOpacity>

        </View>

        {/* CHAT LIST */}

        <FlatList
          data={filteredChats()}
          keyExtractor={item => item.id}
          renderItem={renderChat}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={
            filteredChats().length === 0
              ? styles.emptyList
              : undefined
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>
                {activeTab === "chats"
                  ? "💬"
                  : activeTab === "groups"
                  ? "👥"
                  : "📢"}
              </Text>

              <Text style={styles.emptyTitle}>
                {activeTab === "chats"
                  ? "Пока нет чатов"
                  : activeTab === "groups"
                  ? "Пока нет групп"
                  : "Пока нет каналов"}
              </Text>
            </View>
          }
        />

        {/* BOTTOM BUTTON */}

        <TouchableOpacity
          style={styles.floatingButton}
          activeOpacity={0.8}
          onPress={() =>
            Alert.alert(
              "PrēDa",
              activeTab === "groups"
                ? "Создание группы"
                : activeTab === "channels"
                ? "Создание канала"
                : "Новый чат"
            )
          }
        >
          <Text style={styles.plus}>
            +
          </Text>
        </TouchableOpacity>

      </View>

      {/* SEARCH MODAL */}

      <Modal
        visible={searchVisible}
        animationType="slide"
        onRequestClose={() =>
          setSearchVisible(false)
        }
      >
        <SafeAreaView style={styles.searchScreen}>

          <View style={styles.searchHeader}>

            <TouchableOpacity
              onPress={() =>
                setSearchVisible(false)
              }
              style={styles.backButton}
            >
              <Text style={styles.back}>
                ‹
              </Text>
            </TouchableOpacity>

            <Text style={styles.searchTitle}>
              Поиск пользователя
            </Text>

          </View>

          <View style={styles.searchContent}>

            <Text style={styles.searchLabel}>
              Публичный код
            </Text>

            <TextInput
              value={searchCode}
              onChangeText={setSearchCode}
              placeholder="Например PD-A8F42C91"
              placeholderTextColor="#A58F80"
              autoCapitalize="characters"
              style={styles.searchInput}
              onSubmitEditing={searchUser}
            />

            <TouchableOpacity
              style={styles.searchAction}
              onPress={searchUser}
              disabled={searching}
            >
              <Text style={styles.searchActionText}>
                {searching
                  ? "Поиск..."
                  : "Найти"}
              </Text>
            </TouchableOpacity>

            {foundUser && (
              <View style={styles.profileCard}>

                <View style={styles.profileAvatar}>
                  <Text style={styles.profileAvatarText}>
                    {foundUser.name
                      ?.charAt(0)
                      ?.toUpperCase() || "?"}
                  </Text>
                </View>

                <Text style={styles.profileName}>
                  {foundUser.name}
                </Text>

                <Text style={styles.profileBio}>
                  {foundUser.bio ||
                    "Нет описания"}
                </Text>

                <Text style={styles.profileCode}>
                  {foundUser.public_code}
                </Text>

                <TouchableOpacity
                  style={styles.addButton}
                  onPress={() =>
                    Alert.alert(
                      "PrēDa",
                      "Пользователь добавлен в контакты"
                    )
                  }
                >
                  <Text style={styles.addButtonText}>
                    Добавить в контакты
                  </Text>
                </TouchableOpacity>

              </View>
            )}

          </View>

        </SafeAreaView>
      </Modal>

      {/* CHAT SCREEN */}

      <Modal
        visible={selectedChat !== null}
        animationType="slide"
        onRequestClose={closeChat}
      >
        <SafeAreaView style={styles.chatScreen}>

          <View style={styles.chatHeader}>

            <TouchableOpacity
              onPress={closeChat}
              style={styles.backButton}
            >
              <Text style={styles.back}>
                ‹
              </Text>
            </TouchableOpacity>

            <View style={styles.smallAvatar}>
              <Text>
                {selectedChat?.avatar}
              </Text>
            </View>

            <View>
              <Text style={styles.chatScreenTitle}>
                {selectedChat?.title}
              </Text>

              <Text style={styles.online}>
                PrēDa
              </Text>
            </View>

          </View>

          <View style={styles.messages}>
            <View style={styles.messageBubble}>
              <Text style={styles.messageText}>
                {selectedChat?.preview}
              </Text>
            </View>
          </View>

          <View style={styles.messageInputRow}>

            <TouchableOpacity
              style={styles.attach}
            >
              <Text>
                📎
              </Text>
            </TouchableOpacity>

            <TextInput
              style={styles.messageInput}
              placeholder="Сообщение"
              placeholderTextColor="#92796A"
            />

            <TouchableOpacity
              style={styles.send}
            >
              <Text style={styles.sendText}>
                ➤
              </Text>
            </TouchableOpacity>

          </View>

        </SafeAreaView>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: CREAM
  },

  container: {
    flex: 1,
    backgroundColor: CREAM
  },

  header: {
    height: 70,
    backgroundColor: BROWN,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20
  },

  logo: {
    color: "#FFFFFF",
    fontSize: 27,
    fontWeight: "700"
  },

  searchButton: {
    width: 45,
    height: 45,
    borderRadius: 23,
    justifyContent: "center",
    alignItems: "center"
  },

  searchIcon: {
    fontSize: 24
  },

  tabs: {
    flexDirection: "row",
    height: 54,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: "#E8DDD5"
  },

  tab: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center"
  },

  activeTab: {
    borderBottomWidth: 3,
    borderBottomColor: BROWN
  },

  tabText: {
    fontSize: 15,
    color: "#806D61",
    fontWeight: "600"
  },

  activeTabText: {
    color: BROWN
  },

  chatRow: {
    height: 78,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: "#EFE7E1"
  },

  avatar: {
    width: 55,
    height: 55,
    borderRadius: 28,
    backgroundColor: LIGHT_BROWN,
    justifyContent: "center",
    alignItems: "center"
  },

  avatarText: {
    fontSize: 22,
    color: BROWN,
    fontWeight: "700"
  },

  chatInfo: {
    flex: 1,
    marginLeft: 13
  },

  chatTop: {
    flexDirection: "row",
    justifyContent: "space-between"
  },

  chatTitle: {
    fontSize: 17,
    color: "#2D211A",
    fontWeight: "600"
  },

  chatTime: {
    fontSize: 12,
    color: "#9B8779"
  },

  chatPreview: {
    marginTop: 5,
    color: "#8A776A",
    fontSize: 14
  },

  floatingButton: {
    position: "absolute",
    right: 20,
    bottom: 25,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: BROWN,
    justifyContent: "center",
    alignItems: "center",
    elevation: 7,
    shadowOpacity: 0.25,
    shadowRadius: 5
  },

  plus: {
    color: "#FFFFFF",
    fontSize: 34,
    fontWeight: "300",
    marginTop: -2
  },

  emptyList: {
    flexGrow: 1
  },

  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center"
  },

  emptyIcon: {
    fontSize: 45,
    marginBottom: 12
  },

  emptyTitle: {
    color: "#806D61",
    fontSize: 17
  },

  searchScreen: {
    flex: 1,
    backgroundColor: CREAM
  },

  searchHeader: {
    height: 65,
    backgroundColor: BROWN,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10
  },

  backButton: {
    width: 45,
    height: 45,
    alignItems: "center",
    justifyContent: "center"
  },

  back: {
    color: "#FFFFFF",
    fontSize: 40,
    fontWeight: "200",
    lineHeight: 40
  },

  searchTitle: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "600"
  },

  searchContent: {
    padding: 20
  },

  searchLabel: {
    color: DARK_BROWN,
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 8
  },

  searchInput: {
    height: 55,
    borderWidth: 1,
    borderColor: "#D6C4B7",
    borderRadius: 12,
    paddingHorizontal: 16,
    color: "#2D211A",
    backgroundColor: "#FFFFFF",
    fontSize: 16
  },

  searchAction: {
    height: 53,
    marginTop: 14,
    borderRadius: 12,
    backgroundColor: BROWN,
    alignItems: "center",
    justifyContent: "center"
  },

  searchActionText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700"
  },

  profileCard: {
    marginTop: 25,
    padding: 24,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    elevation: 3
  },

  profileAvatar: {
    width: 82,
    height: 82,
    borderRadius: 41,
    backgroundColor: LIGHT_BROWN,
    alignItems: "center",
    justifyContent: "center"
  },

  profileAvatarText: {
    fontSize: 32,
    color: BROWN,
    fontWeight: "700"
  },

  profileName: {
    marginTop: 12,
    fontSize: 23,
    fontWeight: "700",
    color: "#2D211A"
  },

  profileBio: {
    marginTop: 6,
    color: "#806D61",
    fontSize: 15,
    textAlign: "center"
  },

  profileCode: {
    marginTop: 12,
    color: BROWN,
    fontWeight: "700"
  },

  addButton: {
    width: "100%",
    height: 50,
    marginTop: 20,
    borderRadius: 12,
    backgroundColor: BROWN,
    justifyContent: "center",
    alignItems: "center"
  },

  addButtonText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 15
  },

  chatScreen: {
    flex: 1,
    backgroundColor: "#EFE5DD"
  },

  chatHeader: {
    height: 65,
    backgroundColor: BROWN,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8
  },

  smallAvatar: {
    width: 43,
    height: 43,
    borderRadius: 22,
    backgroundColor: LIGHT_BROWN,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10
  },

  chatScreenTitle: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "700"
  },

  online: {
    color: "#E5D8CF",
    fontSize: 12,
    marginTop: 2
  },

  messages: {
    flex: 1,
    padding: 15
  },

  messageBubble: {
    alignSelf: "flex-start",
    maxWidth: "80%",
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    padding: 11
  },

  messageText: {
    color: "#2D211A",
    fontSize: 15
  },

  messageInputRow: {
    minHeight: 62,
    backgroundColor: "#FFFFFF",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8
  },

  attach: {
    width: 45,
    alignItems: "center",
    justifyContent: "center"
  },

  messageInput: {
    flex: 1,
    minHeight: 45,
    maxHeight: 100,
    borderRadius: 22,
    backgroundColor: "#F2EAE4",
    paddingHorizontal: 17,
    color: "#2D211A"
  },

  send: {
    width: 45,
    height: 45,
    borderRadius: 23,
    backgroundColor: BROWN,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 7
  },

  sendText: {
    color: "#FFFFFF",
    fontSize: 19
  }
});